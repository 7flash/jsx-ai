#!/usr/bin/env bun
// Agent protocol benchmark. This is deliberately a fixed-turn protocol test,
// not a claim about end-to-end autonomous-agent success.

import { mkdirSync, writeFileSync } from "fs";
import { callLLM, md } from "../src/index";
import type { LLMResponse, CallOptions } from "../src/index";
import {
  buildPrompt,
  extractRequestedSkills,
  resultToAssistantMessage,
  resultToToolMessages,
} from "./agent";

const MODEL = process.env.BENCH_MODEL || "gemini-2.5-flash";
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "5");
const MAX_TOKENS = parseInt(process.env.BENCH_MAX_TOKENS || "24000");
const STRATEGY_NAMES = ["native", "nlt", "natural"] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

type TurnStatus = "ok" | "truncated" | "error";

interface TurnScore {
  turn: number;
  checks: Record<string, boolean>;
  score: number;
  maxScore: number;
  details: string;
}

interface Scenario {
  name: string;
  task: string;
  turn2Injection: string;
  turn3Injection: string;
  scoreTurn1(result: LLMResponse): TurnScore;
  scoreTurn2(result: LLMResponse): TurnScore;
  scoreTurn3(result: LLMResponse): TurnScore;
}

function computeScore(
  turn: number,
  checks: Record<string, boolean>,
  weights: Record<string, number>,
): TurnScore {
  let points = 0,
    max = 0;
  const details: string[] = [];
  for (const [name, passed] of Object.entries(checks)) {
    const weight = weights[name] || 3;
    max += weight;
    if (passed) points += weight;
    details.push(`${passed ? "✓" : "✗"} ${name}`);
  }
  return {
    turn,
    checks,
    score: max ? Math.round((points / max) * 100) : 0,
    maxScore: max,
    details: details.join(", "),
  };
}

function codeFrom(result: LLMResponse): string[] {
  return result.toolCalls
    .filter((call) => call.name === "write_file")
    .map((call) => String(call.args.content || ""))
    .filter(Boolean);
}

const kvStoreScenario: Scenario = {
  name: "kv-store",
  task: md`
    Build a key-value store API with TTL (time-to-live) expiration.

    Requirements:

    - POST /kv/:key — set a value (body: { value, ttl_seconds? })
    - GET /kv/:key — get a value (404 if expired or missing)
    - DELETE /kv/:key — delete a key
    - GET /kv — list all non-expired keys
    - Expired keys should be cleaned up automatically

    Use Bun + SQLite for persistence. TypeScript strict mode.
  `,
  turn2Injection: md`
    Objectives accepted. Skills activated.

    Environment results:
    package.json = { "name": "kv-store", "version": "1.0.0", "type": "module" }
    src/ is empty.

    Implement the objectives now. Write the necessary files with write_file.
    Independent writes may be emitted in one turn.
  `,
  turn3Injection: md`
    The files were written and I ran bun test:

    src/server.test.ts:
    ✓ POST /kv/:key sets a value
    ✓ GET /kv/:key retrieves a value
    ✓ GET /kv/:key returns 404 for missing key
    ✗ GET /kv/:key returns 404 for expired key
    Expected: 404
    Received: 200
    ✓ DELETE /kv/:key removes a key
    ✓ GET /kv lists all keys

    5 pass, 1 fail

    Expired keys still return 200. Fix the expiration bug, update objectives, then call done.
  `,

  scoreTurn1(result) {
    const calls = result.toolCalls;
    const objectives = calls.find((call) => call.name === "set_objectives");
    const skillCalls = calls.filter((call) => call.name === "use_skill");
    const text = String(objectives?.args.objectives || "");
    return computeScore(
      1,
      {
        called_use_skill: skillCalls.length > 0,
        "requested_2+_skills": skillCalls.length >= 2,
        requested_bun: skillCalls.some((call) =>
          /bun/i.test(String(call.args.skill_name || "")),
        ),
        called_set_objectives: !!objectives,
        has_reasoning: String(objectives?.args.reasoning || "").length > 20,
        "3+_objectives": (text.match(/^\d+\./gm) || []).length >= 3,
        mentions_ttl: /ttl|expir/i.test(text),
        // Negative checks only score if the model actually produced a protocol action.
        no_premature_write:
          calls.length > 0 && !calls.some((call) => call.name === "write_file"),
      },
      {
        called_use_skill: 10,
        "requested_2+_skills": 6,
        requested_bun: 5,
        called_set_objectives: 15,
        has_reasoning: 5,
        "3+_objectives": 8,
        mentions_ttl: 6,
        no_premature_write: 8,
      },
    );
  },

  scoreTurn2(result) {
    const writes = result.toolCalls.filter(
      (call) => call.name === "write_file",
    );
    const code = codeFrom(result);
    const allCode = code.join("\n");
    const dbCode = code
      .filter((source) => /bun:sqlite|\bDatabase\b|\.prepare\(/.test(source))
      .join("\n");
    const serverCode = code
      .filter((source) => /Bun\.serve|\/kv(?:\b|\/)/.test(source))
      .join("\n");
    const testCode = code
      .filter((source) => /bun:test|\b(?:it|test)\s*\(/.test(source))
      .join("\n");

    return computeScore(
      2,
      {
        "writes_3+_files": writes.length >= 3,
        creates_db: dbCode.length > 0,
        creates_server: serverCode.length > 0,
        creates_tests: testCode.length > 0,
        uses_bun_sqlite: /bun:sqlite/.test(dbCode),
        uses_bun_serve: /Bun\.serve|export\s+default/.test(serverCode),
        uses_bun_test: /bun:test/.test(testCode),
        imports_types: /from\s*["']\.\/(types)/.test(allCode),
        uses_prepared_stmt: /\.prepare\(/.test(dbCode),
        has_ttl_logic: /ttl|expir|created_at/i.test(allCode),
        has_kv_endpoints: /\/kv/.test(serverCode),
        "has_5+_tests": (testCode.match(/(?:it|test)\s*\(/g) || []).length >= 5,
        no_any: allCode.length > 0 && !/:\s*any\b/.test(allCode),
      },
      {
        "writes_3+_files": 10,
        creates_db: 8,
        creates_server: 8,
        creates_tests: 8,
        uses_bun_sqlite: 5,
        uses_bun_serve: 4,
        uses_bun_test: 3,
        imports_types: 5,
        uses_prepared_stmt: 5,
        has_ttl_logic: 6,
        has_kv_endpoints: 4,
        "has_5+_tests": 5,
        no_any: 4,
      },
    );
  },

  scoreTurn3(result) {
    const writes = result.toolCalls.filter(
      (call) => call.name === "write_file",
    );
    const fixCode = codeFrom(result).join("\n");
    const done = result.toolCalls.find((call) => call.name === "done");
    const directEvidence = `${result.text}\n${fixCode}`;
    return computeScore(
      3,
      {
        addresses_ttl_bug: /ttl|expir|expired|Date\.now|created_at|404/i.test(
          directEvidence,
        ),
        writes_fix: writes.length > 0,
        // Content-based: file naming is not part of the task contract.
        fix_touches_runtime: /bun:sqlite|Bun\.serve|\/kv|ttl|expir/i.test(
          fixCode,
        ),
        updates_objectives: result.toolCalls.some(
          (call) => call.name === "set_objectives",
        ),
        fix_has_expiry_check:
          /Date\.now|created_at\s*\+|expires?_at|WHERE[\s\S]*expir|ttl[\s\S]*(?:<=|<|>)/i.test(
            fixCode,
          ),
        calls_done: !!done,
        done_has_summary: String(done?.args.summary || "").length > 10,
      },
      {
        addresses_ttl_bug: 10,
        writes_fix: 10,
        fix_touches_runtime: 8,
        updates_objectives: 8,
        fix_has_expiry_check: 10,
        calls_done: 6,
        done_has_summary: 3,
      },
    );
  },
};

const SCENARIOS: Scenario[] = [kvStoreScenario];
const runId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
const logDir = `bench/logs/${runId}`;
mkdirSync(logDir, { recursive: true });

function isTruncated(result: LLMResponse): boolean {
  const reason = String(result.finishReason || "").toLowerCase();
  return (
    reason === "length" ||
    reason.includes("max_tokens") ||
    reason.includes("max tokens")
  );
}

function writeLog(
  strategy: string,
  scenario: string,
  turn: number,
  iter: number,
  result: LLMResponse | null,
  latencyMs: number,
  turnScore?: TurnScore,
  error?: string,
) {
  const lines = [
    `═══ ${scenario}/${strategy} iter#${iter + 1} turn#${turn} ═══ ${MODEL} ${new Date().toISOString()} ${latencyMs}ms`,
    "",
  ];
  const prepared = result?.request?.prepared;
  if (prepared?.system)
    lines.push("─── SYSTEM ───", prepared.system.substring(0, 4000), "");
  if (prepared?.messages) {
    lines.push(`─── CANONICAL MESSAGES (${prepared.messages.length}) ───`);
    for (const message of prepared.messages) {
      const extra = message.toolCalls?.length
        ? ` toolCalls=${JSON.stringify(message.toolCalls).substring(0, 3000)}`
        : "";
      const resultMeta =
        message.role === "tool"
          ? ` toolCallId=${message.toolCallId || "?"} toolName=${message.toolName || "?"}`
          : "";
      lines.push(
        `[${message.role}]${resultMeta}${extra}\n${message.content.substring(0, 4000)}`,
      );
    }
    lines.push("");
  }
  lines.push("─── RAW OUTPUT ───");
  lines.push(error ? `ERROR: ${error}` : JSON.stringify(result?.raw, null, 2));
  lines.push("");
  if (result) {
    lines.push("─── PARSED ───");
    lines.push(`finishReason: ${result.finishReason || "?"}`);
    lines.push(`Text: ${(result.text || "(empty)").substring(0, 1000)}`);
    lines.push(`Tool calls: ${result.toolCalls.length}`);
    for (const call of result.toolCalls)
      lines.push(
        `  → ${call.name}(${JSON.stringify(call.args).substring(0, 3000)})`,
      );
    lines.push(
      `Tokens: ${result.usage?.inputTokens ?? "?"} in → ${result.usage?.outputTokens ?? "?"} out`,
    );
  }
  if (turnScore)
    lines.push(
      "",
      `─── TURN ${turn} SCORE: ${turnScore.score}% ───`,
      turnScore.details,
    );
  writeFileSync(
    `${logDir}/${scenario}_${strategy}_i${iter + 1}_t${turn}.txt`,
    lines.join("\n"),
  );
}

interface TurnResult {
  turn: number;
  status: TurnStatus;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  score: TurnScore;
  error?: string;
}

interface RunResult {
  scenario: string;
  strategy: string;
  iter: number;
  turns: TurnResult[];
  complete: boolean;
  totalScore?: number;
}

function failedTurn(turn: number, error: string): TurnResult {
  return {
    turn,
    status: "error",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    score: { turn, checks: {}, score: 0, maxScore: 0, details: "ERROR" },
    error,
  };
}

function toTurnResult(
  turn: number,
  result: LLMResponse,
  latencyMs: number,
  score: TurnScore,
): TurnResult {
  return {
    turn,
    status: isTruncated(result) ? "truncated" : "ok",
    latencyMs,
    inputTokens: result.usage?.inputTokens || 0,
    outputTokens: result.usage?.outputTokens || 0,
    toolCalls: result.toolCalls.length,
    score,
  };
}

async function runScenario(
  scenario: Scenario,
  strategyName: StrategyName,
  iter: number,
): Promise<RunResult> {
  const opts: CallOptions = {
    strategy: strategyName,
    model: MODEL,
    temperature: 0.1,
    maxTokens: MAX_TOKENS,
    retries: 3,
    timeoutMs: 90_000,
  };
  const turns: TurnResult[] = [];

  let turn1: LLMResponse;
  try {
    const start = Date.now();
    turn1 = await callLLM(
      buildPrompt({
        messages: [
          {
            role: "user",
            content: `${scenario.task}\n\nReview available skills and call use_skill for what you need. Then call set_objectives. Do not write code yet.`,
          },
        ],
      }),
      opts,
    );
    const score = scenario.scoreTurn1(turn1);
    const latency = Date.now() - start;
    turns.push(toTurnResult(1, turn1, latency, score));
    writeLog(strategyName, scenario.name, 1, iter, turn1, latency, score);
  } catch (error: any) {
    const message = error?.message || String(error);
    turns.push(failedTurn(1, message));
    writeLog(strategyName, scenario.name, 1, iter, null, 0, undefined, message);
    return {
      scenario: scenario.name,
      strategy: strategyName,
      iter,
      turns,
      complete: false,
    };
  }

  const requestedSkills = extractRequestedSkills(turn1);
  let turn2: LLMResponse;
  try {
    const start = Date.now();
    turn2 = await callLLM(
      buildPrompt({
        messages: [
          { role: "user", content: scenario.task },
          resultToAssistantMessage(turn1),
          ...resultToToolMessages(turn1),
          { role: "user", content: scenario.turn2Injection },
        ],
        resolvedSkills: requestedSkills,
      }),
      opts,
    );
    const score = scenario.scoreTurn2(turn2);
    const latency = Date.now() - start;
    turns.push(toTurnResult(2, turn2, latency, score));
    writeLog(strategyName, scenario.name, 2, iter, turn2, latency, score);
  } catch (error: any) {
    const message = error?.message || String(error);
    turns.push(failedTurn(2, message));
    writeLog(strategyName, scenario.name, 2, iter, null, 0, undefined, message);
    return {
      scenario: scenario.name,
      strategy: strategyName,
      iter,
      turns,
      complete: false,
    };
  }

  try {
    const start = Date.now();
    const turn3 = await callLLM(
      buildPrompt({
        messages: [
          { role: "user", content: scenario.task },
          resultToAssistantMessage(turn1),
          ...resultToToolMessages(turn1),
          { role: "user", content: scenario.turn2Injection },
          resultToAssistantMessage(turn2),
          ...resultToToolMessages(turn2),
          { role: "user", content: scenario.turn3Injection },
        ],
        resolvedSkills: requestedSkills,
      }),
      opts,
    );
    const score = scenario.scoreTurn3(turn3);
    const latency = Date.now() - start;
    turns.push(toTurnResult(3, turn3, latency, score));
    writeLog(strategyName, scenario.name, 3, iter, turn3, latency, score);
  } catch (error: any) {
    const message = error?.message || String(error);
    turns.push(failedTurn(3, message));
    writeLog(strategyName, scenario.name, 3, iter, null, 0, undefined, message);
  }

  const complete =
    turns.length === 3 && turns.every((turn) => turn.status === "ok");
  const totalScore = complete
    ? Math.round(turns.reduce((sum, turn) => sum + turn.score.score, 0) / 3)
    : undefined;
  return {
    scenario: scenario.name,
    strategy: strategyName,
    iter,
    turns,
    complete,
    totalScore,
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = (seed + 1) * 0x9e3779b1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
      (values.length - 1),
  );
}

async function main() {
  const results: RunResult[] = [];
  console.log(
    `Agent protocol benchmark: ${MODEL} × ${ITERATIONS} iterations × ${STRATEGY_NAMES.length} strategies`,
  );

  for (const scenario of SCENARIOS) {
    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Rotate/randomize order deterministically so one strategy does not always hit rate limits first.
      for (const strategy of seededShuffle(STRATEGY_NAMES, iter)) {
        const result = await runScenario(scenario, strategy, iter);
        results.push(result);
        const statuses = result.turns
          .map((turn) => `t${turn.turn}:${turn.status}/${turn.score.score}%`)
          .join(" ");
        console.log(`${scenario.name}/${strategy}#${iter + 1} ${statuses}`);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  const lines = [
    `Agent protocol benchmark`,
    `run=${runId} model=${MODEL} iterations=${ITERATIONS} maxTokens=${MAX_TOKENS}`,
    `Scores exclude runs with API errors or token-limit truncation.`,
    "",
  ];

  for (const scenario of SCENARIOS) {
    lines.push(`${scenario.name}:`);
    for (const strategy of STRATEGY_NAMES) {
      const runs = results.filter(
        (run) => run.scenario === scenario.name && run.strategy === strategy,
      );
      const valid = runs.filter(
        (run) => run.complete && run.totalScore != null,
      );
      const totals = valid.map((run) => run.totalScore!);
      const errors = runs
        .flatMap((run) => run.turns)
        .filter((turn) => turn.status === "error").length;
      const truncated = runs
        .flatMap((run) => run.turns)
        .filter((turn) => turn.status === "truncated").length;
      const byTurn = [1, 2, 3]
        .map((turnNumber) => {
          const scores = runs.flatMap((run) =>
            run.turns
              .filter(
                (turn) => turn.turn === turnNumber && turn.status === "ok",
              )
              .map((turn) => turn.score.score),
          );
          return scores.length
            ? `t${turnNumber}=${mean(scores).toFixed(1)}±${stddev(scores).toFixed(1)}%`
            : `t${turnNumber}=n/a`;
        })
        .join(" ");
      lines.push(
        `  ${strategy}: valid=${valid.length}/${runs.length} ` +
          `total=${totals.length ? `${mean(totals).toFixed(1)}±${stddev(totals).toFixed(1)}%` : "n/a"} ` +
          `[${byTurn}] errors=${errors} truncated=${truncated}`,
      );
    }
    lines.push("");
  }

  const summary = lines.join("\n");
  const out = {
    runId,
    timestamp: new Date().toISOString(),
    model: MODEL,
    iterations: ITERATIONS,
    maxTokens: MAX_TOKENS,
    strategies: [...STRATEGY_NAMES],
    scenarios: SCENARIOS.map((scenario) => scenario.name),
    results,
  };
  writeFileSync(`${logDir}/results.json`, JSON.stringify(out, null, 2));
  writeFileSync("bench/results.json", JSON.stringify(out, null, 2));
  writeFileSync("bench/summary.txt", summary + "\n");
  console.log("\n" + summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
