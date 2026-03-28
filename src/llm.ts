// ── callLLM — the main entry point ──
//
// Architecture:
//   Strategy (provider-agnostic)  →  Provider (Gemini/OpenAI)  →  HTTP
//
//   1. strategy.prepare(prompt) → PreparedPrompt  (no API specifics)
//   2. provider.buildRequest(prepared) → URL + headers + body
//   3. provider.parseResponse(data) → ProviderResponse
//   4. strategy.parseResponse(providerResponse) → text + toolCalls
//
// Strategies never touch API bodies. Providers never touch tool formatting.

import type { JsxAiNode, LLMResponse, RenderStrategy, ExtractedPrompt } from "./types"
import type { Provider } from "./providers/provider"
import { GeminiProvider } from "./providers/gemini"
import { OpenAIProvider } from "./providers/openai"
import { AnthropicProvider } from "./providers/anthropic"
import { extract } from "./render"
import { native } from "./strategies/native"
import { xml } from "./strategies/xml"
import { natural } from "./strategies/natural"
import { hybrid } from "./strategies/hybrid"
import { nlt } from "./strategies/nlt"

export type { LLMResponse }

export interface CallOptions {
    /** API key (defaults to env vars based on provider) */
    apiKey?: string
    /** Provider to use: "gemini" | "openai". Default: auto-detected from model name */
    provider?: "gemini" | "openai"
    /** Override the strategy ("native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"). Default: "auto" */
    strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"
    /** Override the model */
    model?: string
    /** Override temperature */
    temperature?: number
    /** Override max tokens */
    maxTokens?: number
}

const STRATEGIES: Record<string, RenderStrategy> = { native, xml, natural, hybrid, nlt }
const PROVIDERS: Record<string, Provider> = {
    gemini: new GeminiProvider(),
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
}

// ── Hook System ──
// Hooks receive telemetry for every LLM call (prompt, response, timing, cost)

export interface PromptEvent {
    id: string
    timestamp: number
    method: "callLLM" | "callText" | "streamLLM"
    model: string
    provider: string
    strategy?: string
    messages: Array<{ role: string; content: string }>
    system?: string
    tools?: string[]
    response: {
        text: string
        toolCalls?: Array<{ name: string; args: any }>
    }
    usage?: {
        inputTokens: number
        outputTokens: number
        thinkingTokens?: number
    }
    durationMs: number
    error?: string
}

export type PromptHook = (event: PromptEvent) => void | Promise<void>

const hooks: PromptHook[] = []

/** Register a hook that receives telemetry for every LLM call */
export function registerHook(hook: PromptHook): void {
    hooks.push(hook)
}

/** Fire all hooks (async, non-blocking) */
function fireHooks(event: PromptEvent): void {
    for (const hook of hooks) {
        try { Promise.resolve(hook(event)).catch(() => { }) } catch { }
    }
}

let hookIdCounter = 0
function generateId(): string {
    return `${Date.now()}-${++hookIdCounter}`
}

// Auto-register explorer hook — checks env lazily so it works
// even if JSX_AI_EXPLORER_URL is set after module load
registerHook(async (event) => {
    const url = process.env.JSX_AI_EXPLORER_URL
    if (!url) return
    try {
        await fetch(`${url}/api/prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
        })
    } catch { }
})

/** Register a custom provider */
export function registerProvider(name: string, provider: Provider): void {
    PROVIDERS[name] = provider
}

/** Resolve which strategy to use */
function resolveStrategy(prompt: ExtractedPrompt, override?: string): RenderStrategy {
    const choice = override || prompt.strategy || "auto"
    return STRATEGIES[choice] || hybrid
}

/** Detect provider from model name */
function detectProvider(model: string): string {
    if (/^(gpt-|o[0-9]|chatgpt)/i.test(model)) return "openai"
    if (/^claude/i.test(model)) return "anthropic"
    if (/^(deepseek|qwen)/i.test(model)) return "openai" // DeepSeek & Qwen use OpenAI-compatible API
    return "gemini"
}

/** Resolve provider instance */
function resolveProvider(model: string, override?: string): Provider {
    const name = override || detectProvider(model)
    const provider = PROVIDERS[name]
    if (!provider) throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(", ")}`)
    return provider
}

/** Resolve API key from options or env vars */
function resolveApiKey(provider: Provider, options?: CallOptions): string {
    if (options?.apiKey) return options.apiKey

    if (provider.name === "openai") {
        if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
        if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
        if (process.env.QWEN_API_KEY) return process.env.QWEN_API_KEY
        if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY
    } else if (provider.name === "anthropic") {
        if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
    } else {
        if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
        if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY
    }

    // Try .config.toml
    try {
        const fs = require("fs")
        const path = require("path")
        const toml = fs.readFileSync(path.resolve(process.cwd(), ".config.toml"), "utf-8")
        const match = toml.match(/api_key\s*=\s*"([^"]+)"/)
        if (match) return match[1]
    } catch { }

    throw new Error(
        `No API key found for ${provider.name}. ` +
        (provider.name === "openai"
            ? "Set OPENAI_API_KEY, DEEPSEEK_API_KEY, QWEN_API_KEY, DASHSCOPE_API_KEY, or pass apiKey option."
            : provider.name === "anthropic"
                ? "Set ANTHROPIC_API_KEY or pass apiKey option."
                : "Set GEMINI_API_KEY, GOOGLE_API_KEY, pass apiKey option, or add .config.toml")
    )
}


// ═══════════════════════════════════════════════════════════════════
//   PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Call an LLM with a JSX-defined prompt.
 *
 * ```tsx
 * const result = await callLLM(
 *   <>
 *     <system>You are a coding agent</system>
 *     <tool name="exec" description="Run a shell command">
 *       <param name="command" type="string" required>The command to run</param>
 *     </tool>
 *     <message role="user">List the files in the current directory</message>
 *   </>,
 *   { model: "gemini-2.5-flash" }
 * )
 *
 * result.toolCalls  // [{ name: "exec", args: { command: "ls" } }]
 * ```
 */
type MeasureModule = { measure?: <T>(label: string, fn: () => Promise<T>) => Promise<T> }

type MeasureModuleLoader = () => Promise<MeasureModule>

const defaultMeasureModuleLoader: MeasureModuleLoader = () => import("measure-fn")
let measureModuleLoader: MeasureModuleLoader = defaultMeasureModuleLoader

export function __setMeasureModuleLoaderForTests(loader?: MeasureModuleLoader): void {
    measureModuleLoader = loader || defaultMeasureModuleLoader
}

async function measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
        const mod = await measureModuleLoader()
        if (typeof mod.measure === "function") return await mod.measure(label, fn)
    } catch { }
    return await fn()
}

export async function callLLM(tree: JsxAiNode, options?: CallOptions): Promise<LLMResponse> {
    const t0 = Date.now()

    // 1. Extract structured data from JSX tree
    const prompt = extract(tree)

    // 2. Apply option overrides
    if (options?.model) prompt.model = options.model
    if (options?.temperature != null) prompt.temperature = options.temperature
    if (options?.maxTokens != null) prompt.maxTokens = options.maxTokens

    // 3. Resolve strategy + provider
    const strategy = resolveStrategy(prompt, options?.strategy)
    const model = prompt.model || "gemini-2.5-flash"
    // Use provider from options, or from prompt JSX prop, or detect from model
    const providerOverride = options?.provider || (prompt as any).providerOverride
    const provider = resolveProvider(model, providerOverride)
    const apiKey = resolveApiKey(provider, options)

    // 4. Strategy transforms the prompt (provider-agnostic)
    const prepared = strategy.prepare(prompt)

    // 5. Provider builds the request
    const { url, headers, body } = provider.buildRequest(prepared, model, apiKey)

    const res = await measureAsync(`fetch ${url}`, () => fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    }))

    if (!res.ok) {
        const errText = await res.text()
        console.error('[jsx-ai] Request failed:', res.status, 'URL:', url, 'Body:', JSON.stringify(body).substring(0, 300))
        const error = `LLM API error ${res.status}: ${errText.substring(0, 500)}`
        fireHooks({
            id: generateId(), timestamp: t0, method: "callLLM", model,
            provider: provider.name, strategy: strategy.name,
            messages: prompt.messages, system: prompt.system,
            tools: prompt.tools.map(t => t.name),
            response: { text: '' }, durationMs: Date.now() - t0, error,
        })
        throw new Error(error)
    }

    const data = await res.json()

    // 6. Provider normalizes the response
    const providerResponse = provider.parseResponse(data)

    // 7. Strategy parses the normalized response
    const { text, toolCalls } = strategy.parseResponse(providerResponse)

    const result: LLMResponse = {
        text,
        toolCalls,
        raw: data,
        request: { url, body },
        usage: providerResponse.usage,
    }

    // 8. Fire hooks
    fireHooks({
        id: generateId(), timestamp: t0, method: "callLLM", model,
        provider: provider.name, strategy: strategy.name,
        messages: prompt.messages, system: prompt.system,
        tools: prompt.tools.map(t => t.name),
        response: { text, toolCalls },
        usage: providerResponse.usage,
        durationMs: Date.now() - t0,
    })

    return result
}

/**
 * Render a JSX tree to the extracted prompt data (without calling the LLM).
 * Useful for debugging/inspecting what would be sent.
 */
export function render(tree: JsxAiNode): ExtractedPrompt {
    return extract(tree)
}

/** Register a custom strategy */
export function registerStrategy(name: string, strategy: RenderStrategy): void {
    STRATEGIES[name] = strategy
}

/**
 * Simple text-in/text-out LLM call — no JSX needed.
 * Uses the provider system for routing and auth.
 *
 * ```ts
 * const text = await callText("gemini-2.5-flash", [
 *   { role: "system", content: "You are a planner" },
 *   { role: "user", content: "Break this task into steps" },
 * ])
 * ```
 */
export async function callText(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; maxTokens?: number; apiKey?: string },
): Promise<string> {
    const t0 = Date.now()
    const provider = resolveProvider(model, undefined)
    const apiKey = resolveApiKey(provider, options)

    const system = messages.find(m => m.role === "system")?.content || ""
    const nonSystem = messages.filter(m => m.role !== "system")

    const prepared = {
        system,
        messages: nonSystem.map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 8000,
    }

    const { url, headers, body } = provider.buildRequest(prepared, model, apiKey)

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    })

    if (!res.ok) {
        const errText = await res.text()
        const error = `LLM API error ${res.status}: ${errText.substring(0, 500)}`
        fireHooks({
            id: generateId(), timestamp: t0, method: "callText", model,
            provider: provider.name, messages, system,
            response: { text: '' }, durationMs: Date.now() - t0, error,
        })
        throw new Error(error)
    }

    const data = await res.json()
    const result = provider.parseResponse(data)

    fireHooks({
        id: generateId(), timestamp: t0, method: "callText", model,
        provider: provider.name, messages, system,
        response: { text: result.text },
        usage: result.usage,
        durationMs: Date.now() - t0,
    })

    return result.text
}

/**
 * Stream LLM responses token-by-token via SSE.
 * Uses the same provider routing and auth as callText/callLLM.
 *
 * ```ts
 * for await (const chunk of streamLLM("gemini-2.5-flash", [
 *   { role: "system", content: "You are helpful" },
 *   { role: "user", content: "Tell me a story" },
 * ])) {
 *   process.stdout.write(chunk)
 * }
 * ```
 */
export async function* streamLLM(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; maxTokens?: number; apiKey?: string },
): AsyncGenerator<string> {
    const provider = resolveProvider(model, undefined)
    const apiKey = resolveApiKey(provider, options)
    const temperature = options?.temperature ?? 0.3
    const maxTokens = options?.maxTokens ?? 8000

    const system = messages.find(m => m.role === "system")?.content
    const nonSystem = messages.filter(m => m.role !== "system" && m.content?.trim())

    // ── Gemini Streaming ──
    if (provider.name === "gemini") {
        // Merge consecutive same-role messages (Gemini rejects them)
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
        for (const m of nonSystem) {
            const role = m.role === "assistant" ? "model" : "user"
            const last = contents[contents.length - 1]
            if (last && last.role === role) {
                last.parts[0]!.text += "\n\n" + m.content
            } else {
                contents.push({ role, parts: [{ text: m.content }] })
            }
        }

        const body = {
            contents,
            generationConfig: { temperature, maxOutputTokens: maxTokens },
            ...(system && { systemInstruction: { parts: [{ text: system }] } }),
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
        const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }

        const res = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, `Gemini stream ${model}`)
        if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Gemini stream failed (${res.status}): ${errText.substring(0, 300)}`)
        }

        yield* parseSSEStream(res, (json: any) => json.candidates?.[0]?.content?.parts?.[0]?.text || "")
        return
    }

    // ── Anthropic Streaming ──
    if (provider.name === "anthropic") {
        const body = {
            model,
            max_tokens: maxTokens,
            messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
            stream: true,
            ...(system && { system }),
        }

        const res = await fetchWithRetry(
            "https://api.anthropic.com/v1/messages",
            {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
                body: JSON.stringify(body),
            },
            `Anthropic stream ${model}`,
        )
        if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Anthropic stream failed (${res.status}): ${errText.substring(0, 300)}`)
        }

        yield* parseSSEStream(res, (json: any) => {
            if (json.type === "content_block_delta") return json.delta?.text || ""
            return ""
        })
        return
    }

    // ── OpenAI-compatible Streaming (OpenAI, DeepSeek, Qwen, OpenRouter, local) ──
    const isDeepseek = model.includes("deepseek")
    const isQwen = model.includes("qwen")
    const baseUrl = isDeepseek
        ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "")
        : isQwen
            ? (process.env.DASHSCOPE_BASE_URL || process.env.OPENAI_API_URL || "https://coding-intl.dashscope.aliyuncs.com/v1").replace(/\/$/, "")
            : (process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")

    const isReasoning = /^o[0-9]/.test(model)
    const body = isReasoning
        ? { model, temperature: 1.0, messages, max_completion_tokens: maxTokens, stream: true }
        : { model, temperature, messages, max_tokens: maxTokens, stream: true }

    const res = await fetchWithRetry(
        `${baseUrl}/chat/completions`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        },
        `OpenAI stream ${model}`,
    )
    if (!res.ok) {
        const errText = await res.text()
        throw new Error(`LLM stream failed (${res.status}): ${errText.substring(0, 300)}`)
    }

    yield* parseSSEStream(res, (json: any) => json.choices?.[0]?.delta?.content || "")
}


// ═══════════════════════════════════════════════════════════════════
//   INTERNALS
// ═══════════════════════════════════════════════════════════════════

/** Retry fetch on transient errors (429, 500, 502, 503) with exponential backoff */
async function fetchWithRetry(
    url: string,
    init: RequestInit,
    label: string,
    attempts = 4,
    delayMs = 5000,
): Promise<Response> {
    for (let i = 0; i < attempts; i++) {
        const res = await fetch(url, init)
        if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) {
            if (i === attempts - 1) {
                const errText = await res.text()
                throw new Error(`${label} failed after ${attempts} retries (${res.status}): ${errText.substring(0, 200)}`)
            }
            const wait = delayMs * Math.pow(2, i)
            console.log(`[${label}] ${res.status} — retrying in ${(wait / 1000).toFixed(0)}s (attempt ${i + 1}/${attempts})`)
            await new Promise(r => setTimeout(r, wait))
            continue
        }
        return res
    }
    throw new Error(`${label} exhausted retries`) // unreachable
}

/** Generic SSE stream parser — reads data: lines and extracts text via extractor fn */
async function* parseSSEStream(
    res: Response,
    extractText: (json: any) => string,
): AsyncGenerator<string> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const json = line.slice(6).trim()
            if (!json || json === "[DONE]") continue
            try {
                const data = JSON.parse(json)
                const text = extractText(data)
                if (text) yield text
            } catch { /* skip unparseable chunks */ }
        }
    }
}
