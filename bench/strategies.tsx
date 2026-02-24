#!/usr/bin/env bun
// ── jsx-ai Agentic Benchmark ──
//
// Tests the exact pattern smart-agent uses: multi-turn objective management.
//
// The agent receives a user request and must:
//   Turn 1 (Plan):    Define objectives with set_objectives
//   Turn 2 (Execute): Implement based on discovered context
//   Turn 3 (Adapt):   Fix issues from test output, update objectives
//
// The same JSX-composed prompt is tested across strategies.
//
// Run: bgrun jsx-bench --restart

import { measure, configure } from "measure-fn"
import { callLLM, md } from "../src/index"
import type { LLMResponse } from "../src/types"
import type { CallOptions } from "../src/llm"
import { mkdirSync } from "fs"

const MODEL = "gemini-2.5-flash"
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "2")
const STRATEGY_NAMES = ["native", "nlt", "natural"] as const
type StrategyName = (typeof STRATEGY_NAMES)[number]


// ═══════════════════════════════════════════════════════════════════
//   SKILL WRAPPERS — inject methodology into any task
// ═══════════════════════════════════════════════════════════════════

function AgentCore({ children }: { children?: any }) {
    return <>
        <system>{md`
            You are an autonomous coding agent. You work in iterations:

            1. PLAN — Analyze the task, break it into objectives, call set_objectives
            2. EXECUTE — Implement objectives using tools (write_file, exec)
            3. ADAPT — When results come back, adjust objectives and continue

            ## Rules
            - ALWAYS call set_objectives before writing any code
            - Each objective should be specific and verifiable
            - When you discover new information, UPDATE your objectives
            - When tests fail, add a fix objective and continue
            - Call done when ALL objectives are complete
        `}</system>
        {children}
    </>
}

function BunExpert({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## Bun Runtime
            - HTTP: Bun.serve() with export default { port, fetch } pattern
            - Database: import { Database } from "bun:sqlite", use db.prepare()
            - Testing: import { describe, it, expect } from "bun:test"
            - File I/O: Bun.file() / Bun.write()
            - Run: bun run {file}, bun test
        `}</system>
        {children}
    </>
}

function StrictTypeScript({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## TypeScript
            - Define interfaces for all data shapes in types.ts
            - Import shared types — never duplicate
            - Never use : any — use proper types
            - All public functions must have JSDoc
        `}</system>
        {children}
    </>
}


// ═══════════════════════════════════════════════════════════════════
//   TOOL COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const SetObjectivesTool = () => (
    <tool name="set_objectives" description="Define or update the current list of objectives. Call this BEFORE writing any code, and again when objectives change.">
        <param name="objectives" type="string" required>
            A numbered list of specific, verifiable objectives. Example:
            1. Create src/types.ts with Todo and ApiResponse interfaces
            2. Create src/db.ts with initDb(), addTodo(), getTodos(), toggleTodo()
            3. Create src/server.ts with CRUD endpoints
            4. Create src/server.test.ts with 6+ test cases
            5. Run tests and verify all pass
        </param>
        <param name="reasoning" type="string" required>Why these objectives, and any adjustments from previous plan</param>
    </tool>
)

const WriteFileTool = () => (
    <tool name="write_file" description="Write content to a file, creating directories as needed">
        <param name="path" type="string" required>Path to write the file</param>
        <param name="content" type="string" required>Full file content to write</param>
    </tool>
)

const ExecTool = () => (
    <tool name="exec" description="Execute a shell command and return stdout/stderr">
        <param name="command" type="string" required>The shell command to run</param>
    </tool>
)

const DoneTool = () => (
    <tool name="done" description="Signal that all objectives are complete">
        <param name="summary" type="string" required>Summary of what was accomplished</param>
    </tool>
)


// ═══════════════════════════════════════════════════════════════════
//   MULTI-TURN SCENARIO
//
//   Simulates the smart-agent agentic loop:
//     User message → Plan → Execute → Discover → Adapt → Done
// ═══════════════════════════════════════════════════════════════════

const USER_TASK = md`
    Build a key-value store API with TTL (time-to-live) expiration.

    Requirements:
    - POST /kv/:key — set a value (body: { value, ttl_seconds? })
    - GET /kv/:key — get a value (404 if expired or missing)
    - DELETE /kv/:key — delete a key
    - GET /kv — list all non-expired keys
    - Expired keys should be cleaned up automatically

    Use Bun + SQLite for persistence. TypeScript strict mode.
`

// Context injected between turns (simulating tool results + discoveries)
const TURN2_INJECTION = md`
    Objectives accepted.

    I ran \`cat package.json\` and found the project already has:
    \`\`\`json
    {
        "name": "kv-store",
        "version": "1.0.0",
        "type": "module",
        "dependencies": { }
    }
    \`\`\`

    I also ran \`ls src/\` — the directory is empty, no existing code.

    Now implement your objectives. Write all files using write_file calls.
    You can make multiple tool calls in a single turn.
`

const TURN3_INJECTION = md`
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
    200 instead of 404. Fix this bug and update your objectives to reflect
    the fix. Then call done.
`

/** Build the Turn 1 prompt (Planning) */
function buildTurn1() {
    return (
        <AgentCore>
            <BunExpert>
                <StrictTypeScript>
                    <prompt model={MODEL} temperature={0.1} maxTokens={8000}>
                        <SetObjectivesTool />
                        <WriteFileTool />
                        <ExecTool />
                        <DoneTool />
                        <message role="user">{md`
                            ${USER_TASK}

                            IMPORTANT: Start by calling set_objectives to define your plan.
                            Do NOT write any code yet — just plan.
                        `}</message>
                    </prompt>
                </StrictTypeScript>
            </BunExpert>
        </AgentCore>
    )
}

/** Summarize a turn's tool calls for conversation history */
function summarizeTurn(result: LLMResponse): string {
    const parts: string[] = []
    if (result.text) parts.push(result.text)
    for (const tc of result.toolCalls) {
        if (tc.name === "set_objectives") {
            parts.push(`[Called set_objectives]\n${tc.args.objectives || tc.args.reasoning || ""}`)
        } else if (tc.name === "write_file") {
            const preview = (tc.args.content || "").substring(0, 200)
            parts.push(`[Called write_file: ${tc.args.path}]\n${preview}...`)
        } else if (tc.name === "exec") {
            parts.push(`[Called exec: ${tc.args.command}]`)
        } else if (tc.name === "done") {
            parts.push(`[Called done: ${tc.args.summary}]`)
        } else {
            parts.push(`[Called ${tc.name}]`)
        }
    }
    return parts.join("\n\n")
}

/** Build the Turn 2 prompt (Execute — includes turn 1 history) */
function buildTurn2(turn1Result: LLMResponse) {
    return (
        <AgentCore>
            <BunExpert>
                <StrictTypeScript>
                    <prompt model={MODEL} temperature={0.1} maxTokens={16000}>
                        <SetObjectivesTool />
                        <WriteFileTool />
                        <ExecTool />
                        <DoneTool />
                        <message role="user">{md`
                            ${USER_TASK}

                            Start by calling set_objectives to define your plan.
                        `}</message>
                        <message role="assistant">{summarizeTurn(turn1Result)}</message>
                        <message role="user">{TURN2_INJECTION}</message>
                    </prompt>
                </StrictTypeScript>
            </BunExpert>
        </AgentCore>
    )
}

/** Build the Turn 3 prompt (Adapt — includes turn 1+2 history) */
function buildTurn3(turn1Result: LLMResponse, turn2Result: LLMResponse) {
    return (
        <AgentCore>
            <BunExpert>
                <StrictTypeScript>
                    <prompt model={MODEL} temperature={0.1} maxTokens={8000}>
                        <SetObjectivesTool />
                        <WriteFileTool />
                        <ExecTool />
                        <DoneTool />
                        <message role="user">{md`
                            ${USER_TASK}

                            Start by calling set_objectives to define your plan.
                        `}</message>
                        <message role="assistant">{summarizeTurn(turn1Result)}</message>
                        <message role="user">{TURN2_INJECTION}</message>
                        <message role="assistant">{summarizeTurn(turn2Result)}</message>
                        <message role="user">{TURN3_INJECTION}</message>
                    </prompt>
                </StrictTypeScript>
            </BunExpert>
        </AgentCore>
    )
}


// ═══════════════════════════════════════════════════════════════════
//   SCORING — per turn
// ═══════════════════════════════════════════════════════════════════

interface TurnScore {
    turn: number
    checks: Record<string, boolean>
    score: number
    maxScore: number
    details: string
}

function scoreTurn1(result: LLMResponse): TurnScore {
    const calls = result.toolCalls
    const objectives = calls.find(c => c.name === "set_objectives")
    const objText = objectives?.args.objectives || ""
    const reasoning = objectives?.args.reasoning || ""

    const checks: Record<string, boolean> = {
        "called_set_objectives": !!objectives,
        "has_reasoning": reasoning.length > 20,
        "3+_objectives": (objText.match(/^\d+\./gm) || []).length >= 3,
        "mentions_types": /types|interface/i.test(objText),
        "mentions_db": /db|database|sqlite/i.test(objText),
        "mentions_server": /server|api|endpoint/i.test(objText),
        "mentions_tests": /test/i.test(objText),
        "mentions_ttl": /ttl|expir/i.test(objText),
        "no_premature_write": !calls.some(c => c.name === "write_file"),
        "no_premature_exec": !calls.some(c => c.name === "exec"),
    }

    const weights: Record<string, number> = {
        called_set_objectives: 15,
        has_reasoning: 5,
        "3+_objectives": 10,
        mentions_types: 5,
        mentions_db: 5,
        mentions_server: 5,
        mentions_tests: 5,
        mentions_ttl: 8,
        no_premature_write: 8,
        no_premature_exec: 4,
    }

    return computeScore(1, checks, weights)
}

function scoreTurn2(result: LLMResponse): TurnScore {
    const calls = result.toolCalls
    const writes = calls.filter(c => c.name === "write_file")
    const allCode = writes.map(c => c.args.content || "").join("\n")
    const dbFile = writes.find(c => (c.args.path || "").includes("db"))
    const serverFile = writes.find(c =>
        (c.args.path || "").includes("server") && !(c.args.path || "").includes("test")
    )
    const testFile = writes.find(c => (c.args.path || "").includes("test"))
    const typesFile = writes.find(c => (c.args.path || "").includes("types"))

    const dbCode = dbFile?.args.content || ""
    const serverCode = serverFile?.args.content || ""
    const testCode = testFile?.args.content || ""

    const checks: Record<string, boolean> = {
        "writes_3+_files": writes.length >= 3,
        "creates_types": !!typesFile,
        "creates_db": !!dbFile,
        "creates_server": !!serverFile,
        "creates_tests": !!testFile,
        "uses_bun_sqlite": /bun:sqlite/.test(dbCode),
        "uses_bun_serve": /Bun\.serve|export\s+default/.test(serverCode),
        "uses_bun_test": /bun:test/.test(testCode),
        "imports_types": /from\s*["']\.\/(types|\.\/types)/.test(allCode),
        "uses_prepared_stmt": /\.prepare\(/.test(dbCode),
        "has_ttl_column": /ttl|expir|created_at/i.test(dbCode),
        "has_kv_endpoints": /\/kv/.test(serverCode),
        "has_5+_tests": (testCode.match(/(?:it|test)\s*\(/g) || []).length >= 5,
        "no_any": !/:\s*any\b/.test(allCode),
    }

    const weights: Record<string, number> = {
        "writes_3+_files": 10,
        creates_types: 5,
        creates_db: 8,
        creates_server: 8,
        creates_tests: 8,
        uses_bun_sqlite: 5,
        uses_bun_serve: 4,
        uses_bun_test: 3,
        imports_types: 5,
        uses_prepared_stmt: 5,
        has_ttl_column: 6,
        has_kv_endpoints: 4,
        "has_5+_tests": 5,
        no_any: 4,
    }

    return computeScore(2, checks, weights)
}

function scoreTurn3(result: LLMResponse): TurnScore {
    const calls = result.toolCalls
    const writes = calls.filter(c => c.name === "write_file")
    const objectives = calls.find(c => c.name === "set_objectives")
    const done = calls.find(c => c.name === "done")
    const allContent = [
        result.text,
        ...calls.map(c => JSON.stringify(c.args)),
    ].join(" ")

    const checks: Record<string, boolean> = {
        "addresses_ttl_bug": /ttl|expir|expired|404|timestamp|Date\.now|time/i.test(allContent),
        "writes_fix": writes.length > 0,
        "fix_touches_db_or_server": writes.some(c =>
            /db|server/.test(c.args.path || "")
        ),
        "updates_objectives": !!objectives,
        "fix_mentions_expiry_check": /expir|ttl.*check|Date\.now|created_at\s*\+\s*ttl|WHERE/i.test(
            writes.map(c => c.args.content || "").join("\n")
        ),
        "calls_done": !!done,
        "done_has_summary": (done?.args.summary || "").length > 10,
    }

    const weights: Record<string, number> = {
        addresses_ttl_bug: 10,
        writes_fix: 10,
        fix_touches_db_or_server: 8,
        updates_objectives: 8,
        fix_mentions_expiry_check: 10,
        calls_done: 6,
        done_has_summary: 3,
    }

    return computeScore(3, checks, weights)
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
        turn,
        checks,
        score: max > 0 ? Math.round(points / max * 100) : 0,
        maxScore: max,
        details: details.join(", "),
    }
}


// ═══════════════════════════════════════════════════════════════════
//   INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════

const runId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
const logDir = `bench/logs/${runId}`
mkdirSync(logDir, { recursive: true })
configure({ maxResultLength: 400 })

function writeLog(
    strategy: string, turn: number, iter: number,
    result: LLMResponse | null, latencyMs: number,
    turnScore?: TurnScore, error?: string,
) {
    const filename = `${logDir}/${strategy}_iter${iter + 1}_turn${turn}.txt`
    const lines: string[] = [
        `═══ ${strategy} iter#${iter + 1} turn#${turn} ═══  ${MODEL}  ${new Date().toISOString()}  ${latencyMs.toFixed(0)}ms`, ``
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


interface RunResult {
    strategy: string
    iter: number
    turns: {
        turn: number
        latencyMs: number
        inputTokens: number
        outputTokens: number
        toolCalls: number
        score: TurnScore
    }[]
    totalScore: number
}

async function runIteration(
    strategyName: StrategyName,
    iter: number,
    m: (label: string, fn: () => Promise<string>) => Promise<string>,
): Promise<RunResult> {
    const opts: CallOptions = { strategy: strategyName }
    const turns: RunResult["turns"] = []

    // ── Turn 1: Plan ──
    let turn1Result!: LLMResponse
    await m(`${strategyName}#${iter + 1}/plan`, async () => {
        const start = Date.now()
        try {
            turn1Result = await callLLM(buildTurn1(), opts)
            const latencyMs = Date.now() - start
            const s = scoreTurn1(turn1Result)
            writeLog(strategyName, 1, iter, turn1Result, latencyMs, s)
            turns.push({
                turn: 1, latencyMs,
                inputTokens: turn1Result.usage?.inputTokens || 0,
                outputTokens: turn1Result.usage?.outputTokens || 0,
                toolCalls: turn1Result.toolCalls.length,
                score: s,
            })
            return `plan:${s.score}% ${latencyMs.toFixed(0)}ms tools:${turn1Result.toolCalls.length}`
        } catch (e: any) {
            writeLog(strategyName, 1, iter, null, Date.now() - start, undefined, e.message)
            turns.push({ turn: 1, latencyMs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, score: { turn: 1, checks: {}, score: 0, maxScore: 0, details: "ERROR" } })
            return "ERROR"
        }
    })
    await new Promise(r => setTimeout(r, 500))

    // ── Turn 2: Execute ──
    let turn2Result!: LLMResponse
    await m(`${strategyName}#${iter + 1}/exec`, async () => {
        const start = Date.now()
        try {
            turn2Result = await callLLM(buildTurn2(turn1Result), opts)
            const latencyMs = Date.now() - start
            const s = scoreTurn2(turn2Result)
            writeLog(strategyName, 2, iter, turn2Result, latencyMs, s)
            turns.push({
                turn: 2, latencyMs,
                inputTokens: turn2Result.usage?.inputTokens || 0,
                outputTokens: turn2Result.usage?.outputTokens || 0,
                toolCalls: turn2Result.toolCalls.length,
                score: s,
            })
            return `exec:${s.score}% ${latencyMs.toFixed(0)}ms tools:${turn2Result.toolCalls.length}`
        } catch (e: any) {
            writeLog(strategyName, 2, iter, null, Date.now() - start, undefined, e.message)
            turns.push({ turn: 2, latencyMs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, score: { turn: 2, checks: {}, score: 0, maxScore: 0, details: "ERROR" } })
            return "ERROR"
        }
    })
    await new Promise(r => setTimeout(r, 500))

    // ── Turn 3: Adapt ──
    await m(`${strategyName}#${iter + 1}/adapt`, async () => {
        const start = Date.now()
        try {
            const turn3Result = await callLLM(buildTurn3(turn1Result, turn2Result), opts)
            const latencyMs = Date.now() - start
            const s = scoreTurn3(turn3Result)
            writeLog(strategyName, 3, iter, turn3Result, latencyMs, s)
            turns.push({
                turn: 3, latencyMs,
                inputTokens: turn3Result.usage?.inputTokens || 0,
                outputTokens: turn3Result.usage?.outputTokens || 0,
                toolCalls: turn3Result.toolCalls.length,
                score: s,
            })
            return `adapt:${s.score}% ${latencyMs.toFixed(0)}ms tools:${turn3Result.toolCalls.length}`
        } catch (e: any) {
            writeLog(strategyName, 3, iter, null, Date.now() - start, undefined, e.message)
            turns.push({ turn: 3, latencyMs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, score: { turn: 3, checks: {}, score: 0, maxScore: 0, details: "ERROR" } })
            return "ERROR"
        }
    })

    const totalScore = turns.length > 0
        ? Math.round(turns.reduce((s, t) => s + t.score.score, 0) / turns.length)
        : 0

    return { strategy: strategyName, iter, turns, totalScore }
}


async function main() {
    await measure("Agentic Benchmark", async (m) => {
        const results: RunResult[] = []

        await m("Setup", async () =>
            `${MODEL} × ${ITERATIONS}it × ${STRATEGY_NAMES.length} strategies × 3 turns → ${logDir}/`
        )

        for (let i = 0; i < ITERATIONS; i++) {
            for (const strategyName of STRATEGY_NAMES) {
                const result = await runIteration(strategyName, i, m)
                results.push(result)
                await new Promise(r => setTimeout(r, 800))
            }
        }

        return await m("Summary", async () => {
            const lines: string[] = [``, `── KV Store: AgentCore > BunExpert > StrictTS — 3-turn agentic loop ──`]
            for (const name of STRATEGY_NAMES) {
                const v = results.filter(r => r.strategy === name && r.turns.length > 0)
                const n = v.length
                if (!n) { lines.push(`  ${name}: no results`); continue }

                const avgTotal = (v.reduce((s, r) => s + r.totalScore, 0) / n).toFixed(0)
                const byTurn = [1, 2, 3].map(t => {
                    const turnData = v.flatMap(r => r.turns.filter(tt => tt.turn === t))
                    const avgScore = turnData.length
                        ? (turnData.reduce((s, tt) => s + tt.score.score, 0) / turnData.length).toFixed(0)
                        : "?"
                    return `t${t}=${avgScore}%`
                }).join(" ")

                const totalLat = v.reduce((s, r) => s + r.turns.reduce((ss, t) => ss + t.latencyMs, 0), 0) / n
                const totalOut = v.reduce((s, r) => s + r.turns.reduce((ss, t) => ss + t.outputTokens, 0), 0) / n

                lines.push(`  ${name}: total=${avgTotal}% [${byTurn}] lat=${(totalLat / 1000).toFixed(1)}s out=${totalOut.toFixed(0)}tok`)
            }

            const out = {
                runId, timestamp: new Date().toISOString(),
                model: MODEL, iterations: ITERATIONS,
                strategies: [...STRATEGY_NAMES],
                turns: 3, logDir, results,
            }
            await Bun.write(`${logDir}/results.json`, JSON.stringify(out, null, 2))
            await Bun.write("bench/results.json", JSON.stringify(out, null, 2))
            return lines.join("\n")
        })
    })
}

main().catch(console.error)
