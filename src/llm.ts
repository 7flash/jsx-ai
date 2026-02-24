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
    if (/^deepseek/i.test(model)) return "openai" // DeepSeek uses OpenAI-compatible API
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
            ? "Set OPENAI_API_KEY or pass apiKey option."
            : "Set GEMINI_API_KEY, pass apiKey option, or add .config.toml")
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
export async function callLLM(tree: JsxAiNode, options?: CallOptions): Promise<LLMResponse> {
    // 1. Extract structured data from JSX tree
    const prompt = extract(tree)

    // 2. Apply option overrides
    if (options?.model) prompt.model = options.model
    if (options?.temperature != null) prompt.temperature = options.temperature
    if (options?.maxTokens != null) prompt.maxTokens = options.maxTokens

    // 3. Resolve strategy + provider
    const strategy = resolveStrategy(prompt, options?.strategy)
    const model = prompt.model || "gemini-2.5-flash"
    const provider = resolveProvider(model, options?.provider)
    const apiKey = resolveApiKey(provider, options)

    // 4. Strategy transforms the prompt (provider-agnostic)
    const prepared = strategy.prepare(prompt)

    // 5. Provider builds the request
    const { url, headers, body } = provider.buildRequest(prepared, model, apiKey)

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

    // 6. Provider normalizes the response
    const providerResponse = provider.parseResponse(data)

    // 7. Strategy parses the normalized response
    const { text, toolCalls } = strategy.parseResponse(providerResponse)

    return {
        text,
        toolCalls,
        raw: data,
        request: { url, body },
        usage: providerResponse.usage,
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
