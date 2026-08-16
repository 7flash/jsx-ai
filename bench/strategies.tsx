#!/usr/bin/env bun
// End-to-end agent benchmark: equal budgets, real tool execution, independent final evaluation.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { runAgent, resolveSkills } from "../src/index";
import type {
  AgentRunResult,
  AgentStopReason,
  CallOptions,
  ExtractedMessage,
  ToolCall,
} from "../src/index";
import { buildPrompt, SKILL_PATHS } from "./agent";
import { BENCHMARK_SCENARIOS } from "./scenarios";
import type { BenchmarkScenario, EvaluationResult } from "./scenarios";

const MODEL = process.env.BENCH_MODEL || "gemini-2.5-flash";
const ITERATIONS = numberEnv("BENCH_ITERATIONS", 10);
const RESPONSE_MAX_TOKENS = numberEnv("BENCH_RESPONSE_MAX_TOKENS", 16_000);
const MAX_STEPS = numberEnv("BENCH_MAX_STEPS", 12);
const MAX_TOOL_CALLS = numberEnv("BENCH_MAX_TOOL_CALLS", 64);
const MAX_INPUT_TOKENS = numberEnv("BENCH_MAX_INPUT_TOKENS", 120_000);
const MAX_OUTPUT_TOKENS = numberEnv("BENCH_MAX_OUTPUT_TOKENS", 48_000);
const MAX_DURATION_MS = numberEnv("BENCH_MAX_DURATION_MS", 180_000);
const STRATEGY_NAMES = ["native", "hybrid", "nlt", "natural"] as const;

type StrategyName = (typeof STRATEGY_NAMES)[number];

interface RunState {
  workspace: string;
  resolvedSkills: string[];
  objectives?: string;
  done: boolean;
  doneSummary?: string;
}

interface BenchmarkRun {
  scenario: string;
  strategy: StrategyName;
  iteration: number;
  status: "valid" | "infrastructure_error";
  infrastructureError?: string;
  stopReason?: AgentStopReason;
  finalScore?: number;
  success?: boolean;
  evaluation?: EvaluationResult;
  steps: number;
  toolCalls: number;
  toolErrors: number;
  truncations: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  workspace: string;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive finite number`);
  return value;
}

const runId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
const logDir = join("bench", "logs", runId);
const workRoot = join("bench", "work", runId);
mkdirSync(logDir, { recursive: true });
mkdirSync(workRoot, { recursive: true });

function safeWorkspacePath(workspace: string, input: string): string {
  const trimmed = String(input || "").trim();
  if (!trimmed || isAbsolute(trimmed))
    throw new Error("Path must be non-empty and relative to the workspace");
  const target = resolve(workspace, trimmed);
  const root = resolve(workspace);
  if (target !== root && !target.startsWith(root + "/"))
    throw new Error("Path escapes the isolated workspace");
  return target;
}

function safeExecCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || /(?:^|\s)(?:\.\.|\/etc\/|~\/)/.test(normalized))
    return false;
  if (/[;&|`<>]/.test(normalized)) return false;
  return /^(?:bun test(?: .*)?|bun x tsc --noEmit(?: .*)?|ls(?: .*)?|find(?: .*)?|cat [\w./-]+|pwd)$/.test(
    normalized,
  );
}

async function runDiagnostic(
  command: string,
  workspace: string,
): Promise<string> {
  if (!safeExecCommand(command)) {
    throw new Error(
      "Command rejected by benchmark sandbox. Use bun test, bun x tsc --noEmit, ls, find, cat, or pwd without shell chaining.",
    );
  }
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd: workspace,
    env: { ...process.env, HOME: workspace },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;
  return `exit=${exitCode}\nstdout:\n${stdout.slice(0, 12_000)}\nstderr:\n${stderr.slice(0, 12_000)}`;
}

function executeTool(
  state: RunState,
  call: ToolCall,
): Promise<string> | string {
  switch (call.name) {
    case "use_skill": {
      const requested = String(call.args.skill_name || "").trim();
      const matches = resolveSkills(SKILL_PATHS, [requested]);
      if (matches.length !== 1)
        throw new Error(
          `Skill must resolve uniquely; ${JSON.stringify(requested)} matched ${matches.length}`,
        );
      const name = matches[0]!.name;
      if (!state.resolvedSkills.includes(name)) state.resolvedSkills.push(name);
      return `Activated skill: ${name}`;
    }
    case "set_objectives":
      state.objectives = String(call.args.objectives || "");
      return "Objectives recorded.";
    case "read_file": {
      const path = safeWorkspacePath(
        state.workspace,
        String(call.args.path || ""),
      );
      return readFileSync(path, "utf8").slice(0, 24_000);
    }
    case "write_file": {
      const path = safeWorkspacePath(
        state.workspace,
        String(call.args.path || ""),
      );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(call.args.content ?? ""));
      return `Wrote ${relative(state.workspace, path)} (${String(call.args.content ?? "").length} chars).`;
    }
    case "exec":
      return runDiagnostic(String(call.args.command || ""), state.workspace);
    case "done":
      state.done = true;
      state.doneSummary = String(call.args.summary || "");
      return "Completion signal recorded. The independent evaluator will run next.";
    default:
      throw new Error(`Unknown benchmark tool: ${call.name}`);
  }
}

function isTruncated(reason: string | undefined): boolean {
  const value = String(reason || "").toLowerCase();
  return (
    value === "length" ||
    value.includes("max_tokens") ||
    value.includes("max tokens")
  );
}

function serializeHistory(history: readonly ExtractedMessage[]): unknown[] {
  return history.map((message) => ({
    role: message.role,
    content:
      message.content.length > 12_000
        ? message.content.slice(0, 12_000) + "…"
        : message.content,
    toolCalls: message.toolCalls,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
  }));
}

function writeRunLog(
  run: BenchmarkRun,
  agent?: AgentRunResult<RunState>,
): void {
  const path = join(
    logDir,
    `${run.scenario}_${run.strategy}_i${run.iteration + 1}.json`,
  );
  const payload = {
    ...run,
    history: agent ? serializeHistory(agent.history) : undefined,
    stepResponses: agent?.steps.map((step) => ({
      index: step.index,
      finishReason: step.response.finishReason,
      text: step.response.text.slice(0, 4000),
      toolCalls: step.response.toolCalls,
      usage: step.response.usage,
      preparedPrompt: step.response.request?.prepared,
      durationMs: step.durationMs,
      toolResults: step.toolResults,
    })),
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

async function runOne(
  scenario: BenchmarkScenario,
  strategy: StrategyName,
  iteration: number,
  runIndex: number,
): Promise<BenchmarkRun> {
  const workspace = join(
    workRoot,
    `${scenario.name}_${strategy}_i${iteration + 1}`,
  );
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  await scenario.setup(workspace);

  const state: RunState = { workspace, resolvedSkills: [], done: false };
  const history: ExtractedMessage[] = [
    { role: "user", content: scenario.task },
  ];
  const callOptions: CallOptions = {
    model: MODEL,
    strategy,
    temperature: 0.1,
    maxTokens: RESPONSE_MAX_TOKENS,
    retries: 3,
    timeoutMs: Math.min(90_000, MAX_DURATION_MS),
  };

  const startedAt = Date.now();
  let agent: AgentRunResult<RunState> | undefined;
  let infrastructureError: string | undefined;
  try {
    agent = await runAgent<RunState>({
      history,
      state,
      callOptions,
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      maxInputTokens: MAX_INPUT_TOKENS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxDurationMs: MAX_DURATION_MS,
      buildPrompt: (canonicalHistory, context) =>
        buildPrompt({
          messages: canonicalHistory,
          resolvedSkills: context.state.resolvedSkills,
        }),
      executeTool: (call) => executeTool(state, call),
      isComplete: () => state.done,
      onNoToolCalls: (_response, context) =>
        context.step + 1 < MAX_STEPS
          ? "Continue the task using the available tools. If the implementation is truly complete, call done with a verification summary."
          : false,
    });
  } catch (error: any) {
    infrastructureError = error?.message || String(error);
  }

  const evaluation = await scenario.evaluate(workspace, runIndex);
  const steps = agent?.steps.length || 0;
  const toolErrors =
    agent?.steps
      .flatMap((step) => step.toolResults)
      .filter((result) => result.isError).length || 0;
  const truncations =
    agent?.steps.filter((step) => isTruncated(step.response.finishReason))
      .length || 0;
  const inputTokens = agent?.usage.inputTokens || 0;
  const outputTokens = agent?.usage.outputTokens || 0;
  const thinkingTokens = agent?.usage.thinkingTokens || 0;
  const run: BenchmarkRun = {
    scenario: scenario.name,
    strategy,
    iteration,
    status: infrastructureError ? "infrastructure_error" : "valid",
    ...(infrastructureError ? { infrastructureError } : {}),
    stopReason: agent?.reason,
    finalScore: evaluation.score,
    success: evaluation.success,
    evaluation,
    steps,
    toolCalls: agent?.toolCallsExecuted || 0,
    toolErrors,
    truncations,
    usage: {
      inputTokens,
      outputTokens,
      thinkingTokens,
      totalTokens: inputTokens + outputTokens,
    },
    latencyMs: Date.now() - startedAt,
    workspace,
  };
  writeRunLog(run, agent);
  return run;
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
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
      (values.length - 1),
  );
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index]!;
}

function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const phat = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function summarize(results: BenchmarkRun[]): string {
  const lines = [
    "End-to-end agent benchmark",
    `run=${runId} model=${MODEL} iterations=${ITERATIONS} scenarios=${BENCHMARK_SCENARIOS.length}`,
    `budgets: steps=${MAX_STEPS} tools=${MAX_TOOL_CALLS} input=${MAX_INPUT_TOKENS} output=${MAX_OUTPUT_TOKENS} responseMax=${RESPONSE_MAX_TOKENS} durationMs=${MAX_DURATION_MS}`,
    "Infrastructure/API errors are reported separately and excluded from model-strategy success/score estimates.",
    "A valid run is scored only by independent final-state evaluation; intermediate filenames/tool patterns do not earn points unless explicitly part of the task contract.",
    "",
  ];

  for (const scenario of BENCHMARK_SCENARIOS) {
    lines.push(`${scenario.name}:`);
    for (const strategy of STRATEGY_NAMES) {
      const attempted = results.filter(
        (run) => run.scenario === scenario.name && run.strategy === strategy,
      );
      const valid = attempted.filter((run) => run.status === "valid");
      const successes = valid.filter((run) => run.success).length;
      const [lo, hi] = wilson(successes, valid.length);
      const scores = valid.map((run) => run.finalScore || 0);
      const tokens = valid.map((run) => run.usage.totalTokens);
      const latency = valid.map((run) => run.latencyMs);
      const tools = valid.map((run) => run.toolCalls);
      const truncations = valid.reduce((sum, run) => sum + run.truncations, 0);
      const budgetStops = valid.filter((run) =>
        String(run.stopReason || "").startsWith("max_"),
      ).length;
      const noToolStops = valid.filter(
        (run) => run.stopReason === "no_tool_calls",
      ).length;
      const tokensPerSuccess = successes
        ? valid
            .filter((run) => run.success)
            .reduce((sum, run) => sum + run.usage.totalTokens, 0) / successes
        : 0;

      lines.push(
        `  ${strategy}: valid=${valid.length}/${attempted.length} infra=${attempted.length - valid.length} ` +
          `success=${successes}/${valid.length} (${valid.length ? ((successes / valid.length) * 100).toFixed(1) : "n/a"}%, 95%CI ${valid.length ? `${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}` : "n/a"}) ` +
          `score=${scores.length ? `${mean(scores).toFixed(1)}±${stddev(scores).toFixed(1)}` : "n/a"} ` +
          `tokens[p50/p95]=${tokens.length ? `${percentile(tokens, 0.5).toFixed(0)}/${percentile(tokens, 0.95).toFixed(0)}` : "n/a"} ` +
          `latency[p50/p95]=${latency.length ? `${(percentile(latency, 0.5) / 1000).toFixed(1)}s/${(percentile(latency, 0.95) / 1000).toFixed(1)}s` : "n/a"} ` +
          `tools[p50]=${tools.length ? percentile(tools, 0.5).toFixed(0) : "n/a"} ` +
          `tok/success=${successes ? tokensPerSuccess.toFixed(0) : "n/a"} trunc=${truncations} budgetStops=${budgetStops} noToolStops=${noToolStops}`,
      );
    }
    lines.push("");
  }

  lines.push("Overall:");
  for (const strategy of STRATEGY_NAMES) {
    const attempted = results.filter((run) => run.strategy === strategy);
    const valid = attempted.filter((run) => run.status === "valid");
    const successes = valid.filter((run) => run.success).length;
    const [lo, hi] = wilson(successes, valid.length);
    const scores = valid.map((run) => run.finalScore || 0);
    lines.push(
      `  ${strategy}: valid=${valid.length}/${attempted.length} success=${successes}/${valid.length} ` +
        `(${valid.length ? ((successes / valid.length) * 100).toFixed(1) : "n/a"}%, 95%CI ${valid.length ? `${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}` : "n/a"}) ` +
        `score=${scores.length ? `${mean(scores).toFixed(1)}±${stddev(scores).toFixed(1)}` : "n/a"}`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const results: BenchmarkRun[] = [];
  let runIndex = 0;
  console.log(
    `End-to-end agent benchmark: ${MODEL} × ${ITERATIONS} iterations × ${STRATEGY_NAMES.length} strategies × ${BENCHMARK_SCENARIOS.length} scenarios`,
  );

  for (const scenario of BENCHMARK_SCENARIOS) {
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (const strategy of seededShuffle(
        STRATEGY_NAMES,
        iteration + scenario.name.length * 1009,
      )) {
        const result = await runOne(scenario, strategy, iteration, runIndex++);
        results.push(result);
        console.log(
          `${scenario.name}/${strategy}#${iteration + 1}: status=${result.status} score=${result.finalScore}% ` +
            `success=${result.success} stop=${result.stopReason || "error"} steps=${result.steps} tools=${result.toolCalls} tokens=${result.usage.totalTokens}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  const summary = summarize(results);
  const output = {
    runId,
    timestamp: new Date().toISOString(),
    config: {
      model: MODEL,
      iterations: ITERATIONS,
      strategies: [...STRATEGY_NAMES],
      scenarios: BENCHMARK_SCENARIOS.map((scenario) => scenario.name),
      budgets: {
        responseMaxTokens: RESPONSE_MAX_TOKENS,
        maxSteps: MAX_STEPS,
        maxToolCalls: MAX_TOOL_CALLS,
        maxInputTokens: MAX_INPUT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxDurationMs: MAX_DURATION_MS,
      },
    },
    results,
  };
  writeFileSync(join(logDir, "results.json"), JSON.stringify(output, null, 2));
  writeFileSync("bench/results.json", JSON.stringify(output, null, 2));
  writeFileSync("bench/summary.txt", summary + "\n");
  console.log("\n" + summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
