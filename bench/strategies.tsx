#!/usr/bin/env bun
// ── jsx-ai Agentic Benchmark ──
//
// Imports the example agent and tests it across strategies and models
// with a set of complex multi-turn scenarios.
//
// The benchmark orchestrates the 3-turn agentic loop:
//   Turn 1 (Discover): Agent sees skill catalog → calls use_skill + set_objectives
//   Turn 2 (Execute):  Requested skills resolved → agent writes code
//   Turn 3 (Adapt):    Simulated failure → agent fixes and completes
//
// Run: bgrun jsx-bench --restart

import { measure, configure } from "measure-fn"
import { callLLM, md } from "../src/index"
import type { LLMResponse, CallOptions } from "../src/index"
import { buildPrompt, summarizeTurn, extractRequestedSkills } from "./agent"
import { mkdirSync } from "fs"

const MODEL = process.env.BENCH_MODEL || "gemini-2.5-flash"
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "2")
const STRATEGY_NAMES = ["native", "nlt", "natural"] as const
type StrategyName = (typeof STRATEGY_NAMES)[number]


// ═══════════════════════════════════════════════════════════════════
//   SCENARIO
//
//   A scenario defines one complex task for the agent to solve.
//   It includes the user request, simulated tool results between
//   turns, and scoring functions for each turn.
// ═══════════════════════════════════════════════════════════════════

interface Scenario {
    name: string
    /** The user's initial request */
    task: string
    /** Injected after turn 1 (simulated tool results + discoveries) */
    turn2Injection: string
    /** Injected after turn 2 (simulated test output + issues) */
    turn3Injection: string
    /** Score each turn */
    scoreTurn1(result: LLMResponse): TurnScore
    scoreTurn2(result: LLMResponse): TurnScore
    scoreTurn3(result: LLMResponse): TurnScore
}

interface TurnScore {
    turn: number
    checks: Record<string, boolean>
    score: number
    maxScore: number
    details: string
}

function computeScore(
    turn: number,
    checks: Record<string, boolean>,
    weights: Record<string, number>,
): TurnScore {
    let points = 0, max = 0
    const details: string[] = []
    for (const [name, passed] of Object.entries(checks)) {
        const w = weights[name] || 3
        max += w
        if (passed) points += w
        details.push(`${passed ? "✓" : "✗"} ${name}`)
    }
    return {
        turn, checks,
        score: max > 0 ? Math.round(points / max * 100) : 0,
        maxScore: max,
        details: details.join(", "),
    }
}


// ═══════════════════════════════════════════════════════════════════
//   KV STORE SCENARIO
// ═══════════════════════════════════════════════════════════════════

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

        I ran \`cat package.json\` and found:
        \`\`\`json
        { "name": "kv-store", "version": "1.0.0", "type": "module" }
        \`\`\`

        \`ls src/\` — the directory is empty.

        Now implement your objectives. Write all files using write_file.
        You can make multiple tool calls in a single turn.
    `,

    turn3Injection: md`
        Files written. I ran \`bun test\` and got:

        \`\`\`
        src/server.test.ts:
        ✓ POST /kv/:key sets a value
        ✓ GET /kv/:key retrieves a value
        ✓ GET /kv/:key returns 404 for missing key
        ✗ GET /kv/:key returns 404 for expired key
            Expected: 404
            Received: 200
            at src/server.test.ts:42:20
        ✓ DELETE /kv/:key removes a key
        ✓ GET /kv lists all keys

        5 pass, 1 fail
        \`\`\`

        The TTL expiration check is not working — expired keys still return
        200 instead of 404. Fix this bug and update your objectives. Then call done.
    `,

    scoreTurn1(result) {
        const calls = result.toolCalls
        const objectives = calls.find(c => c.name === "set_objectives")
        const skillCalls = calls.filter(c => c.name === "use_skill")
        const objText = objectives?.args.objectives || ""

        return computeScore(1, {
            "called_use_skill": skillCalls.length > 0,
            "requested_2+_skills": skillCalls.length >= 2,
            "requested_bun": skillCalls.some(c => /bun/i.test(c.args.skill_name || "")),
            "called_set_objectives": !!objectives,
            "has_reasoning": (objectives?.args.reasoning || "").length > 20,
            "3+_objectives": (objText.match(/^\d+\./gm) || []).length >= 3,
            "mentions_ttl": /ttl|expir/i.test(objText),
            "no_premature_write": !calls.some(c => c.name === "write_file"),
        }, {
            called_use_skill: 10,
            "requested_2+_skills": 6,
            requested_bun: 5,
            called_set_objectives: 15,
            has_reasoning: 5,
            "3+_objectives": 8,
            mentions_ttl: 6,
            no_premature_write: 8,
        })
    },

    scoreTurn2(result) {
        const calls = result.toolCalls
        const writes = calls.filter(c => c.name === "write_file")
        const allCode = writes.map(c => c.args.content || "").join("\n")
        const dbCode = writes.find(c => (c.args.path || "").includes("db"))?.args.content || ""
        const serverCode = writes.find(c =>
            (c.args.path || "").includes("server") && !(c.args.path || "").includes("test")
        )?.args.content || ""
        const testCode = writes.find(c => (c.args.path || "").includes("test"))?.args.content || ""

        return computeScore(2, {
            "writes_3+_files": writes.length >= 3,
            "creates_db": writes.some(c => (c.args.path || "").includes("db")),
            "creates_server": writes.some(c => (c.args.path || "").includes("server") && !(c.args.path || "").includes("test")),
            "creates_tests": writes.some(c => (c.args.path || "").includes("test")),
            "uses_bun_sqlite": /bun:sqlite/.test(dbCode),
            "uses_bun_serve": /Bun\.serve|export\s+default/.test(serverCode),
            "uses_bun_test": /bun:test/.test(testCode),
            "imports_types": /from\s*["']\.\/(types)/.test(allCode),
            "uses_prepared_stmt": /\.prepare\(/.test(dbCode),
            "has_ttl_logic": /ttl|expir|created_at/i.test(dbCode),
            "has_kv_endpoints": /\/kv/.test(serverCode),
            "has_5+_tests": (testCode.match(/(?:it|test)\s*\(/g) || []).length >= 5,
            "no_any": !/:\s*any\b/.test(allCode),
        }, {
            "writes_3+_files": 10, creates_db: 8, creates_server: 8, creates_tests: 8,
            uses_bun_sqlite: 5, uses_bun_serve: 4, uses_bun_test: 3,
            imports_types: 5, uses_prepared_stmt: 5, has_ttl_logic: 6,
            has_kv_endpoints: 4, "has_5+_tests": 5, no_any: 4,
        })
    },

    scoreTurn3(result) {
        const calls = result.toolCalls
        const writes = calls.filter(c => c.name === "write_file")
        const done = calls.find(c => c.name === "done")
        const allContent = [result.text, ...calls.map(c => JSON.stringify(c.args))].join(" ")
        const fixCode = writes.map(c => c.args.content || "").join("\n")

        return computeScore(3, {
            "addresses_ttl_bug": /ttl|expir|expired|404|timestamp|Date\.now|time/i.test(allContent),
            "writes_fix": writes.length > 0,
            "fix_touches_db_or_server": writes.some(c => /db|server/.test(c.args.path || "")),
            "updates_objectives": calls.some(c => c.name === "set_objectives"),
            "fix_has_expiry_check": /expir|ttl.*check|Date\.now|created_at\s*\+\s*ttl|WHERE/i.test(fixCode),
            "calls_done": !!done,
            "done_has_summary": (done?.args.summary || "").length > 10,
        }, {
            addresses_ttl_bug: 10, writes_fix: 10, fix_touches_db_or_server: 8,
            updates_objectives: 8, fix_has_expiry_check: 10,
            calls_done: 6, done_has_summary: 3,
        })
    },
}

const SCENARIOS: Scenario[] = [kvStoreScenario]


// ═══════════════════════════════════════════════════════════════════
//   RUNNER
// ═══════════════════════════════════════════════════════════════════

const runId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
const logDir = `bench/logs/${runId}`
mkdirSync(logDir, { recursive: true })
configure({ maxResultLength: 400 })

function writeLog(
    strategy: string, scenario: string, turn: number, iter: number,
    result: LLMResponse | null, latencyMs: number,
    turnScore?: TurnScore, error?: string,
) {
    const filename = `${logDir}/${scenario}_${strategy}_i${iter + 1}_t${turn}.txt`
    const lines: string[] = [
        `═══ ${scenario}/${strategy} iter#${iter + 1} turn#${turn} ═══  ${MODEL}  ${new Date().toISOString()}  ${latencyMs.toFixed(0)}ms`, ``
    ]

    const body = result?.request?.body
    if (body?.systemInstruction?.parts?.[0]?.text) {
        lines.push(`─── SYSTEM ───`, body.systemInstruction.parts[0].text.substring(0, 2000), ``)
    }
    if (body?.contents) {
        lines.push(`─── MESSAGES (${body.contents.length}) ───`)
        for (const c of body.contents) {
            const text = c.parts?.map((p: any) => p.text || `[FC: ${JSON.stringify(p.functionCall)}]`).join("") || ""
            lines.push(`[${c.role}]: ${text.substring(0, 4000)}${text.length > 4000 ? "…" : ""}`)
        }
        lines.push(``)
    }

    lines.push(`─── RAW OUTPUT ───`)
    if (error) lines.push(`ERROR: ${error}`)
    else lines.push(JSON.stringify(result?.raw, null, 2))
    lines.push(``)

    if (result) {
        lines.push(`─── PARSED ───`)
        lines.push(`Text: ${(result.text || "(empty)").substring(0, 500)}`)
        lines.push(`Tool calls: ${result.toolCalls.length}`)
        for (const tc of result.toolCalls) {
            const argsStr = JSON.stringify(tc.args)
            lines.push(`  → ${tc.name}(${argsStr.substring(0, 1500)}${argsStr.length > 1500 ? "…" : ""})`)
        }
        lines.push(`Tokens: ${result.usage?.inputTokens || "?"} in → ${result.usage?.outputTokens || "?"} out`)
    }
    if (turnScore) {
        lines.push(``, `─── TURN ${turn} SCORE: ${turnScore.score}% ───`, turnScore.details)
    }
    lines.push(``)
    Bun.write(filename, lines.join("\n"))
}

interface TurnResult {
    turn: number; latencyMs: number
    inputTokens: number; outputTokens: number
    toolCalls: number; score: TurnScore
}

interface RunResult {
    scenario: string; strategy: string; iter: number
    turns: TurnResult[]
    totalScore: number
}

const emptyTurn = (turn: number): TurnResult => ({
    turn, latencyMs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0,
    score: { turn, checks: {}, score: 0, maxScore: 0, details: "ERROR" },
})

async function runScenario(
    scenario: Scenario,
    strategyName: StrategyName,
    iter: number,
    m: (label: string, fn: () => Promise<string>) => Promise<string>,
): Promise<RunResult> {
    const opts: CallOptions = { strategy: strategyName, model: MODEL, temperature: 0.1, maxTokens: 16000 }
    const turns: TurnResult[] = []
    const label = `${scenario.name}/${strategyName}#${iter + 1}`

    // ── Turn 1: Discover + Plan ──
    let turn1Result!: LLMResponse
    await m(`${label}/discover`, async () => {
        const start = Date.now()
        try {
            const tree = buildPrompt({
                messages: [
                    { role: "user", content: `${scenario.task}\n\nReview the available skills and activate the ones you need with use_skill. Then call set_objectives to define your plan. Do NOT write any code yet.` },
                ],
            })
            turn1Result = await callLLM(tree, opts)
            const latencyMs = Date.now() - start
            const s = scenario.scoreTurn1(turn1Result)
            writeLog(strategyName, scenario.name, 1, iter, turn1Result, latencyMs, s)
            const skills = extractRequestedSkills(turn1Result)
            turns.push({ turn: 1, latencyMs, inputTokens: turn1Result.usage?.inputTokens || 0, outputTokens: turn1Result.usage?.outputTokens || 0, toolCalls: turn1Result.toolCalls.length, score: s })
            return `discover:${s.score}% ${latencyMs.toFixed(0)}ms skills:[${skills.join(",")}]`
        } catch (e: any) {
            writeLog(strategyName, scenario.name, 1, iter, null, Date.now() - start, undefined, e.message)
            turns.push(emptyTurn(1))
            return "ERROR"
        }
    })
    await new Promise(r => setTimeout(r, 500))

    const requestedSkills = extractRequestedSkills(turn1Result)

    // ── Turn 2: Execute ──
    let turn2Result!: LLMResponse
    await m(`${label}/execute`, async () => {
        const start = Date.now()
        try {
            const tree = buildPrompt({
                messages: [
                    { role: "user", content: scenario.task },
                    { role: "assistant", content: summarizeTurn(turn1Result) },
                    { role: "user", content: scenario.turn2Injection },
                ],
                resolvedSkills: requestedSkills,
            })
            turn2Result = await callLLM(tree, opts)
            const latencyMs = Date.now() - start
            const s = scenario.scoreTurn2(turn2Result)
            writeLog(strategyName, scenario.name, 2, iter, turn2Result, latencyMs, s)
            turns.push({ turn: 2, latencyMs, inputTokens: turn2Result.usage?.inputTokens || 0, outputTokens: turn2Result.usage?.outputTokens || 0, toolCalls: turn2Result.toolCalls.length, score: s })
            return `execute:${s.score}% ${latencyMs.toFixed(0)}ms tools:${turn2Result.toolCalls.length}`
        } catch (e: any) {
            writeLog(strategyName, scenario.name, 2, iter, null, Date.now() - start, undefined, e.message)
            turns.push(emptyTurn(2))
            return "ERROR"
        }
    })
    await new Promise(r => setTimeout(r, 500))

    // ── Turn 3: Adapt ──
    await m(`${label}/adapt`, async () => {
        const start = Date.now()
        try {
            const tree = buildPrompt({
                messages: [
                    { role: "user", content: scenario.task },
                    { role: "assistant", content: summarizeTurn(turn1Result) },
                    { role: "user", content: scenario.turn2Injection },
                    { role: "assistant", content: summarizeTurn(turn2Result) },
                    { role: "user", content: scenario.turn3Injection },
                ],
                resolvedSkills: requestedSkills,
            })
            const turn3Result = await callLLM(tree, opts)
            const latencyMs = Date.now() - start
            const s = scenario.scoreTurn3(turn3Result)
            writeLog(strategyName, scenario.name, 3, iter, turn3Result, latencyMs, s)
            turns.push({ turn: 3, latencyMs, inputTokens: turn3Result.usage?.inputTokens || 0, outputTokens: turn3Result.usage?.outputTokens || 0, toolCalls: turn3Result.toolCalls.length, score: s })
            return `adapt:${s.score}% ${latencyMs.toFixed(0)}ms tools:${turn3Result.toolCalls.length}`
        } catch (e: any) {
            writeLog(strategyName, scenario.name, 3, iter, null, Date.now() - start, undefined, e.message)
            turns.push(emptyTurn(3))
            return "ERROR"
        }
    })

    const totalScore = turns.length > 0
        ? Math.round(turns.reduce((s, t) => s + t.score.score, 0) / turns.length)
        : 0

    return { scenario: scenario.name, strategy: strategyName, iter, turns, totalScore }
}


async function main() {
    await measure("Agentic Benchmark", async (m) => {
        const results: RunResult[] = []

        await m("Setup", async () =>
            `${MODEL} × ${ITERATIONS}it × ${STRATEGY_NAMES.length} strategies × ${SCENARIOS.length} scenarios × 3 turns → ${logDir}/`
        )

        for (const scenario of SCENARIOS) {
            for (let i = 0; i < ITERATIONS; i++) {
                for (const strategyName of STRATEGY_NAMES) {
                    const result = await runScenario(scenario, strategyName, i, m)
                    results.push(result)
                    await new Promise(r => setTimeout(r, 800))
                }
            }
        }

        return await m("Summary", async () => {
            const lines: string[] = [``, `── Agentic Benchmark: 2-phase skills × 3-turn loop ──`]

            for (const scenario of SCENARIOS) {
                lines.push(``, `  ${scenario.name}:`)
                for (const name of STRATEGY_NAMES) {
                    const v = results.filter(r =>
                        r.scenario === scenario.name && r.strategy === name && r.turns.length > 0
                    )
                    const n = v.length
                    if (!n) { lines.push(`    ${name}: no results`); continue }

                    const avgTotal = (v.reduce((s, r) => s + r.totalScore, 0) / n).toFixed(0)
                    const byTurn = [1, 2, 3].map(t => {
                        const td = v.flatMap(r => r.turns.filter(tt => tt.turn === t))
                        return td.length
                            ? `t${t}=${(td.reduce((s, tt) => s + tt.score.score, 0) / td.length).toFixed(0)}%`
                            : `t${t}=?`
                    }).join(" ")

                    const totalLat = v.reduce((s, r) => s + r.turns.reduce((ss, t) => ss + t.latencyMs, 0), 0) / n
                    const totalOut = v.reduce((s, r) => s + r.turns.reduce((ss, t) => ss + t.outputTokens, 0), 0) / n

                    lines.push(`    ${name}: total=${avgTotal}% [${byTurn}] lat=${(totalLat / 1000).toFixed(1)}s out=${totalOut.toFixed(0)}tok`)
                }
            }

            const out = {
                runId, timestamp: new Date().toISOString(),
                model: MODEL, iterations: ITERATIONS,
                strategies: [...STRATEGY_NAMES],
                scenarios: SCENARIOS.map(s => s.name),
                turns: 3, logDir, results,
            }
            await Bun.write(`${logDir}/results.json`, JSON.stringify(out, null, 2))
            await Bun.write("bench/results.json", JSON.stringify(out, null, 2))
            return lines.join("\n")
        })
    })
}

main().catch(console.error)
