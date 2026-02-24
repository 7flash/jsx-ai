// ── callLLM — the main entry point ──
//
// Architecture:
//   Strategy (provider-agnostic)  →  Provider (Gemini/OpenAI)  →  HTTP
//
//   1. strategy.prepare(prompt) → PreparedPrompt  (no API specifics)
//   2. provider converts PreparedPrompt → API body  (Gemini format)
//   3. provider parses API response → LLMResponse
//   4. strategy.parseToolCalls(text) for text-based strategies
//
// Strategies never touch API bodies. Providers never touch tool formatting.

import type { JsxAiNode, LLMResponse, RenderStrategy, ExtractedPrompt, PreparedPrompt, ToolCall } from "./types"
import { extract } from "./render"
import { native } from "./strategies/native"
import { xml } from "./strategies/xml"
import { natural } from "./strategies/natural"
import { hybrid } from "./strategies/hybrid"
import { nlt } from "./strategies/nlt"

export type { LLMResponse }

export interface CallOptions {
    /** API key (defaults to GEMINI_API_KEY or GOOGLE_API_KEY env var) */
    apiKey?: string
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

/** Resolve which strategy to use */
function resolveStrategy(prompt: ExtractedPrompt, override?: string): RenderStrategy {
    const choice = override || prompt.strategy || "auto"
    return STRATEGIES[choice] || hybrid
}

/** Resolve API key from options, env, or config file */
function resolveApiKey(options?: CallOptions): string {
    if (options?.apiKey) return options.apiKey
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY

    // Try .config.toml
    try {
        const fs = require("fs")
        const path = require("path")
        const toml = fs.readFileSync(path.resolve(process.cwd(), ".config.toml"), "utf-8")
        const match = toml.match(/api_key\s*=\s*"([^"]+)"/)
        if (match) return match[1]
    } catch { }

    throw new Error("No API key found. Set GEMINI_API_KEY, pass apiKey option, or add .config.toml")
}


// ═══════════════════════════════════════════════════════════════════
//   GEMINI PROVIDER
//   Converts PreparedPrompt ↔ Gemini API format
// ═══════════════════════════════════════════════════════════════════

function geminiEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

function geminiHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
    }
}

/** Convert a PreparedPrompt into Gemini's API body format */
function toGeminiBody(prepared: PreparedPrompt): any {
    const body: any = {
        contents: prepared.messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        })),
        generationConfig: {
            temperature: prepared.temperature ?? 0.1,
            maxOutputTokens: prepared.maxTokens ?? 4000,
        },
    }

    if (prepared.system) {
        body.systemInstruction = { parts: [{ text: prepared.system }] }
    }

    if (prepared.nativeTools && prepared.nativeTools.length > 0) {
        body.tools = [{
            functionDeclarations: prepared.nativeTools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            })),
        }]
        body.toolConfig = { functionCallingConfig: { mode: "AUTO" } }
    }

    return body
}

/** Extract text and native tool calls from a Gemini API response */
function parseGeminiResponse(data: any): { text: string; nativeToolCalls: ToolCall[] } {
    const parts = data.candidates?.[0]?.content?.parts || []
    let text = ""
    const nativeToolCalls: ToolCall[] = []

    for (const part of parts) {
        if (part.text) text += part.text
        if (part.functionCall) {
            nativeToolCalls.push({
                name: part.functionCall.name,
                args: part.functionCall.args || {},
            })
        }
    }

    return { text, nativeToolCalls }
}

/** Extract usage metadata from a Gemini response */
function parseGeminiUsage(data: any): LLMResponse["usage"] {
    const usage = data.usageMetadata
    return usage ? {
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
    } : undefined
}


// ═══════════════════════════════════════════════════════════════════
//   PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Call an LLM with a JSX-defined prompt.
 * 
 * ```tsx
 * const result = await callLLM(
 *   <prompt model="gemini-2.5-flash">
 *     <system>You are a coding agent</system>
 *     <tool name="exec" description="Run a shell command">
 *       <param name="command" type="string" required>The command to run</param>
 *     </tool>
 *     <message role="user">List the files in the current directory</message>
 *   </prompt>
 * )
 * 
 * result.toolCalls  // [{ name: "exec", args: { command: "ls" } }]
 * result.text       // ""  (native FC returns structured calls, not text)
 * ```
 */
export async function callLLM(tree: JsxAiNode, options?: CallOptions): Promise<LLMResponse> {
    // 1. Extract structured data from JSX tree
    const prompt = extract(tree)

    // 2. Apply option overrides
    if (options?.model) prompt.model = options.model
    if (options?.temperature != null) prompt.temperature = options.temperature
    if (options?.maxTokens != null) prompt.maxTokens = options.maxTokens

    // 3. Strategy transforms the prompt (provider-agnostic)
    const strategy = resolveStrategy(prompt, options?.strategy)
    const prepared = strategy.prepare(prompt)

    // 4. Provider converts to API format and sends request
    const apiKey = resolveApiKey(options)
    const model = prompt.model || "gemini-2.5-flash"
    const url = geminiEndpoint(model)
    const headers = geminiHeaders(apiKey)
    const body = toGeminiBody(prepared)

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    })

    if (!res.ok) {
        const errText = await res.text()
        throw new Error(`LLM API error ${res.status}: ${errText.substring(0, 500)}`)
    }

    const data = await res.json()

    // 5. Provider parses response
    const { text, nativeToolCalls } = parseGeminiResponse(data)

    // 6. Tool calls: use native FC if available, otherwise strategy parses from text
    const toolCalls = nativeToolCalls.length > 0
        ? nativeToolCalls
        : (strategy.parseToolCalls?.(text) ?? [])

    return {
        text,
        toolCalls,
        raw: data,
        request: { url, body },
        usage: parseGeminiUsage(data),
    }
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
