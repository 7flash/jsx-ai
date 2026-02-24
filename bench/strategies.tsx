#!/usr/bin/env bun
// ── jsx-ai Composition Benchmark ──
//
// Demonstrates the core value of jsx-ai: SKILL WRAPPERS as JSX components.
//
// Just like React wraps UI in <ThemeProvider>, jsx-ai wraps tasks in skills:
//
//   <BunExpert>
//     <StrictTypeScript>
//       <SecurityAware>
//         <CodeReviewer>
//           <TestDriven>
//             <prompt>
//               <WriteFile /> <ExecTool />
//               <message role="user">Build a URL shortener</message>
//             </prompt>
//           </TestDriven>
//         </CodeReviewer>
//       </SecurityAware>
//     </StrictTypeScript>
//   </BunExpert>
//
// Each wrapper injects methodology. The SAME tree works across strategies.
//
// Run: bgrun jsx-bench --restart

import { measure, configure } from "measure-fn"
import { extract } from "../src/render"
import { md } from "../src/jsx-runtime"
import { native } from "../src/strategies/native"
import { natural } from "../src/strategies/natural"
import { nlt } from "../src/strategies/nlt"
import type { RenderStrategy, LLMResponse, ExtractedPrompt } from "../src/types"
import { mkdirSync } from "fs"

const MODEL = "gemini-2.5-flash"
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "2")
const STRATEGIES: Record<string, RenderStrategy> = { native, nlt, natural }


// ═══════════════════════════════════════════════════════════════════
//
//   SKILL WRAPPERS
//
//   Each component wraps children in a methodology — like how
//   <SystematicDebugging>fix the memory leak</SystematicDebugging>
//   compiles the task into a full debugging methodology prompt.
//
// ═══════════════════════════════════════════════════════════════════

/** Wraps children with Bun runtime expertise */
function BunExpert({ children }: { children?: any }) {
    return <>
        <system>{md`
            You are an expert Bun runtime developer.

            ## Bun Runtime Knowledge
            - Use Bun.serve() for HTTP servers — never express, koa, or hono
            - Use export default { port, fetch } pattern for servers
            - Database: import { Database } from "bun:sqlite" — always use db.prepare()
            - Testing: import { describe, it, expect } from "bun:test"
            - File I/O: Bun.file() for reading, Bun.write() for writing
            - TypeScript works out of the box — no tsconfig needed
            - Use bun run {file} to execute, bun test to run tests
        `}</system>
        {children}
    </>
}

/** Wraps children with strict TypeScript quality constraints */
function StrictTypeScript({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## TypeScript Standards (STRICT)
            - Define interfaces for ALL data shapes — no inline object types
            - Export all interfaces from a dedicated types.ts file
            - Import shared types — NEVER duplicate type definitions
            - NEVER use : any — use proper types, generics, or unknown
            - NEVER use var — use const (preferred) or let
            - All public functions MUST have JSDoc comments
            - Prefer named exports over default exports
        `}</system>
        {children}
    </>
}

/** Wraps children with security-aware development methodology */
function SecurityAware({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## Security Methodology
            - NEVER interpolate user input into SQL — use parameterized queries
            - NEVER use Math.random() for IDs — use crypto.randomUUID()
            - Validate and sanitize ALL user input at the API boundary
            - Validate Content-Type headers before parsing request bodies
            - Never expose internal error details or stack traces in responses
            - Use proper HTTP status codes: 400 bad input, 404 not found, 500 server error
        `}</system>
        {children}
    </>
}

/** Wraps children with code review self-check methodology */
function CodeReviewer({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## Code Review Methodology
            When producing code, self-check against these criteria:

            ### Quality Gates
            - Separation of concerns: types, data layer, server, tests in separate files
            - No console.log in library code — use proper error handling
            - Error paths tested — not just happy paths
            - All imports resolve — don't import from files you haven't created
            - Functions focused and single-responsibility

            ### Architecture
            - Data layer exposes clean functions, not raw database queries
            - Server handlers are thin — delegate to data layer
            - Types shared via imports, never duplicated
            - Tests call the public API, not internal details
        `}</system>
        {children}
    </>
}

/** Wraps children with testing methodology */
function TestDriven({ children }: { children?: any }) {
    return <>
        <system>{md`
            ## Testing Methodology
            - Test files named {module}.test.ts, co-located with the module
            - Each test is independent — no shared mutable state between tests
            - Test structure: describe blocks grouping related scenarios
            - Coverage: happy path + error cases + edge cases
            - For HTTP: test status codes AND response body shapes
            - Minimum 6 test cases per module
        `}</system>
        {children}
    </>
}


// ═══════════════════════════════════════════════════════════════════
//
//   TOOL COMPONENTS
//
// ═══════════════════════════════════════════════════════════════════

const WriteFileTool = () => (
    <tool name="write_file" description="Write content to a file, creating directories as needed">
        <param name="path" type="string" required>Path to write the file</param>
        <param name="content" type="string" required>Full file content to write</param>
    </tool>
)

const EditFileTool = () => (
    <tool name="edit_file" description="Replace an exact string in a file with new content">
        <param name="path" type="string" required>Path to the file</param>
        <param name="search" type="string" required>Exact string to find</param>
        <param name="replace" type="string" required>Replacement string</param>
    </tool>
)

const ExecTool = () => (
    <tool name="exec" description="Execute a shell command and return stdout/stderr">
        <param name="command" type="string" required>The shell command to run</param>
    </tool>
)


// ═══════════════════════════════════════════════════════════════════
//
//   THE BENCHMARK — COMPOSED PROMPT
//
// ═══════════════════════════════════════════════════════════════════

const EXISTING_TYPES = `/** URL record stored in the database */
export interface ShortUrl {
  id: string
  originalUrl: string
  shortCode: string
  createdAt: string
  clicks: number
}

/** Request body for POST /api/shorten */
export interface CreateUrlRequest {
  url: string
}

/** Response body for POST /api/shorten */
export interface CreateUrlResponse {
  shortUrl: string
  shortCode: string
}

/** Standardized error response */
export interface ErrorResponse {
  error: string
  statusCode: number
}`

const composedPrompt = (
    <BunExpert>
        <StrictTypeScript>
            <SecurityAware>
                <CodeReviewer>
                    <TestDriven>
                        <prompt model={MODEL} temperature={0.1} maxTokens={16000}>
                            <WriteFileTool />
                            <EditFileTool />
                            <ExecTool />
                            <message role="user">{md`
                                Here is the existing types file:

                                \`\`\`typescript
                                // src/types.ts
                                ${EXISTING_TYPES}
                                \`\`\`
                            `}</message>
                            <message role="user">{md`
                                Build a URL shortener API. The types are already defined in
                                src/types.ts — import from there.

                                Create these files using write_file:
                                1. src/db.ts — Database layer with initDb(), createUrl(), getUrl() using bun:sqlite
                                2. src/server.ts — HTTP server: POST /api/shorten, GET /s/:code (302 redirect), GET /api/stats/:code, GET /health
                                3. src/server.test.ts — Tests covering happy paths and error cases

                                Write all tool calls in a single turn.
                            `}</message>
                        </prompt>
                    </TestDriven>
                </CodeReviewer>
            </SecurityAware>
        </StrictTypeScript>
    </BunExpert>
)


// ═══════════════════════════════════════════════════════════════════
//   SCORING — each check maps back to a skill wrapper
// ═══════════════════════════════════════════════════════════════════

interface ScoreResult {
    checks: Record<string, boolean>
    qualityScore: number
    details: string
}

function score(result: LLMResponse): ScoreResult {
    const calls = result.toolCalls
    const writes = calls.filter(c => c.name === "write_file")

    const dbFile = writes.find(c => (c.args.path || "").includes("db"))
    const serverFile = writes.find(c => (c.args.path || "").includes("server") && !(c.args.path || "").includes("test"))
    const testFile = writes.find(c => (c.args.path || "").includes("test"))
    const typesFile = writes.find(c => (c.args.path || "").includes("types"))

    const dbCode = dbFile?.args.content || ""
    const serverCode = serverFile?.args.content || ""
    const testCode = testFile?.args.content || ""

    const checks: Record<string, boolean> = {
        // File structure
        "writes_db": !!dbFile,
        "writes_server": !!serverFile,
        "writes_tests": !!testFile,
        "no_types_rewrite": !typesFile,

        // BunExpert
        "uses_bun_sqlite": /bun:sqlite/.test(dbCode),
        "uses_bun_serve": /Bun\.serve|export\s+default/.test(serverCode),
        "uses_bun_test": /from\s*["']bun:test["']/.test(testCode),

        // StrictTypeScript
        "imports_types": /from\s*["']\.\/types/.test(dbCode) || /from\s*["']\.\/types/.test(serverCode),
        "has_jsdoc": /\/\*\*[\s\S]*?\*\//.test(dbCode) || /\/\*\*[\s\S]*?\*\//.test(serverCode),
        "no_any": !/:\s*any\b/.test(dbCode + serverCode),
        "no_var": !/\bvar\s/.test(dbCode + serverCode + testCode),

        // SecurityAware
        "uses_prepared_stmt": /\.prepare\(/.test(dbCode),
        "uses_uuid": /randomUUID|crypto/.test(dbCode),
        "validates_input": /Content-Type|valid|!.*url/i.test(serverCode),

        // CodeReviewer
        "server_imports_db": /from\s*["']\.\/db/.test(serverCode),
        "no_console_log": !/console\.log\(/.test(dbCode + serverCode),
        "separation_of_concerns": !!dbFile && !!serverFile,

        // TestDriven
        "has_describe": /describe\s*\(/.test(testCode),
        "has_6_plus_tests": (testCode.match(/(?:it|test)\s*\(/g) || []).length >= 5,
        "tests_errors": /400|404|invalid|error|not.?found/i.test(testCode),

        // Routes
        "has_shorten": /shorten/i.test(serverCode),
        "has_redirect": /302|redirect/i.test(serverCode),
        "has_stats": /stats/i.test(serverCode),
        "has_health": /health/i.test(serverCode),
        "has_404": /404/.test(serverCode),
    }

    const weights: Record<string, number> = {
        writes_db: 8, writes_server: 8, writes_tests: 8, no_types_rewrite: 4,
        uses_bun_sqlite: 5, uses_bun_serve: 4, uses_bun_test: 3,
        imports_types: 5, has_jsdoc: 3, no_any: 4, no_var: 2,
        uses_prepared_stmt: 5, uses_uuid: 4, validates_input: 3,
        server_imports_db: 4, no_console_log: 3, separation_of_concerns: 3,
        has_describe: 2, has_6_plus_tests: 4, tests_errors: 3,
        has_shorten: 3, has_redirect: 3, has_stats: 2, has_health: 2, has_404: 2,
    }

    let points = 0, max = 0
    const details: string[] = []
    for (const [name, passed] of Object.entries(checks)) {
        const w = weights[name] || 3
        max += w
        if (passed) points += w
        details.push(`${passed ? "✓" : "✗"} ${name}`)
    }

    return { checks, qualityScore: max > 0 ? Math.round(points / max * 100) : 0, details: details.join(", ") }
}


// ═══════════════════════════════════════════════════════════════════
//   INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════

const runId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
const logDir = `bench/logs/${runId}`
mkdirSync(logDir, { recursive: true })
configure({ maxResultLength: 400 })

function writeLog(
    strategy: string, iter: number,
    request: { url: string; body: any },
    response: any, parsed: LLMResponse | null,
    latencyMs: number, scoreResult?: ScoreResult, error?: string,
) {
    const filename = `${logDir}/${strategy}_${iter + 1}.txt`
    const lines: string[] = [
        `═══ ${strategy} #${iter + 1} ═══  ${MODEL}  ${new Date().toISOString()}  ${latencyMs.toFixed(0)}ms`, ``
    ]
    const body = request.body
    if (body.systemInstruction?.parts?.[0]?.text) {
        lines.push(`─── SYSTEM ───`, body.systemInstruction.parts[0].text, ``)
    }
    if (body.tools) {
        lines.push(`─── TOOLS (native FC) ───`)
        for (const fd of body.tools?.[0]?.functionDeclarations || [])
            lines.push(`  ${fd.name}: ${fd.description?.substring(0, 80)}`)
        lines.push(``)
    }
    if (body.contents) {
        lines.push(`─── MESSAGES ───`)
        for (const c of body.contents) {
            const text = c.parts?.map((p: any) => p.text || `[FC: ${JSON.stringify(p.functionCall)}]`).join("") || ""
            lines.push(`[${c.role}]: ${text.substring(0, 8000)}${text.length > 8000 ? "…" : ""}`)
        }
        lines.push(``)
    }
    lines.push(`─── RAW OUTPUT ───`)
    if (error) lines.push(`ERROR: ${error}`)
    else lines.push(JSON.stringify(response, null, 2))
    lines.push(``)
    if (parsed) {
        lines.push(`─── PARSED ───`)
        lines.push(`Text: ${(parsed.text || "(empty)").substring(0, 500)}`)
        lines.push(`Tool calls: ${parsed.toolCalls.length}`)
        for (const tc of parsed.toolCalls) {
            const argsStr = JSON.stringify(tc.args)
            lines.push(`  → ${tc.name}(${argsStr.substring(0, 1500)}${argsStr.length > 1500 ? "…" : ""})`)
        }
        lines.push(`Tokens: ${parsed.usage?.inputTokens || "?"} in → ${parsed.usage?.outputTokens || "?"} out`)
    }
    if (scoreResult) {
        lines.push(``, `─── SCORE: ${scoreResult.qualityScore}% ───`, scoreResult.details)
    }
    lines.push(``)
    Bun.write(filename, lines.join("\n"))
}

function loadApiKey(): string {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY
    try {
        const toml = require("fs").readFileSync(".config.toml", "utf-8")
        const match = toml.match(/api_key\s*=\s*"([^"]+)"/)
        if (match) return match[1]
    } catch { }
    throw new Error("No API key. Set GEMINI_API_KEY or GOOGLE_API_KEY")
}
const API_KEY = loadApiKey()

async function callLLM(
    strategy: RenderStrategy, name: string, prompt: ExtractedPrompt, iter: number,
): Promise<{ result: LLMResponse | null; latencyMs: number }> {
    const { url, body, headers } = strategy.buildRequest(prompt, API_KEY)
    const start = Date.now()
    try {
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
        if (!res.ok) {
            const err = await res.text()
            const ms = Date.now() - start
            writeLog(name, iter, { url, body }, null, null, ms, undefined, `HTTP ${res.status}: ${err.substring(0, 500)}`)
            return { result: null, latencyMs: ms }
        }
        const data = await res.json()
        const ms = Date.now() - start
        const parsed = strategy.parseResponse(data)
        const s = score(parsed)
        writeLog(name, iter, { url, body }, data, parsed, ms, s)
        return { result: parsed, latencyMs: ms }
    } catch (e: any) {
        const ms = Date.now() - start
        writeLog(name, iter, { url, body }, null, null, ms, undefined, e.message)
        return { result: null, latencyMs: ms }
    }
}

interface RunResult {
    strategy: string; iter: number; latencyMs: number
    inputTokens: number; outputTokens: number; toolCalls: number
    score: ScoreResult
}

async function main() {
    await measure("JSX Composition Benchmark", async (m) => {
        const results: RunResult[] = []

        await m("Setup", async () =>
            `${MODEL} × ${ITERATIONS}it × ${Object.keys(STRATEGIES).length} strategies → ${logDir}/`
        )

        const tree = composedPrompt

        for (let i = 0; i < ITERATIONS; i++) {
            for (const name of Object.keys(STRATEGIES)) {
                await m(`${name}#${i + 1}`, async () => {
                    const prompt = extract(tree)
                    const { result, latencyMs } = await callLLM(STRATEGIES[name]!, name, prompt, i)

                    if (result) {
                        const s = score(result)
                        results.push({
                            strategy: name, iter: i, latencyMs,
                            inputTokens: result.usage?.inputTokens || 0,
                            outputTokens: result.usage?.outputTokens || 0,
                            toolCalls: result.toolCalls.length,
                            score: s,
                        })
                        return `q:${s.qualityScore}% ${latencyMs.toFixed(0)}ms ${result.usage?.inputTokens}→${result.usage?.outputTokens}tok tools:${result.toolCalls.length}`
                    }
                    results.push({
                        strategy: name, iter: i, latencyMs: 0,
                        inputTokens: 0, outputTokens: 0, toolCalls: 0,
                        score: { checks: {}, qualityScore: 0, details: "ERROR" },
                    })
                    return "ERROR"
                })
                await new Promise(r => setTimeout(r, 800))
            }
        }

        return await m("Summary", async () => {
            const lines: string[] = [``, `── URL Shortener (BunExpert > StrictTS > Security > CodeReviewer > TestDriven) ──`]
            for (const name of Object.keys(STRATEGIES)) {
                const v = results.filter(r => r.strategy === name && r.latencyMs > 0)
                const n = v.length
                if (!n) { lines.push(`  ${name}: no results`); continue }
                lines.push(`  ${name}: quality=${(v.reduce((s, r) => s + r.score.qualityScore, 0) / n).toFixed(0)}% lat=${(v.reduce((s, r) => s + r.latencyMs, 0) / n / 1000).toFixed(1)}s out=${(v.reduce((s, r) => s + r.outputTokens, 0) / n).toFixed(0)}tok tools=${(v.reduce((s, r) => s + r.toolCalls, 0) / n).toFixed(1)}`)
            }
            const out = { runId, timestamp: new Date().toISOString(), model: MODEL, iterations: ITERATIONS, strategies: Object.keys(STRATEGIES), logDir, results }
            await Bun.write(`${logDir}/results.json`, JSON.stringify(out, null, 2))
            await Bun.write("bench/results.json", JSON.stringify(out, null, 2))
            return lines.join("\n")
        })
    })
}

main().catch(console.error)
