// ── Native Function Calling Strategy ──
// Tools go through the provider's native FC mechanism (structured declarations).
// This is the optimal strategy — 17x fewer output tokens, 2x faster latency.

import type { RenderStrategy, ExtractedPrompt, PreparedPrompt } from "../types"

export const native: RenderStrategy = {
    name: "native",

    prepare(prompt: ExtractedPrompt): PreparedPrompt {
        return {
            system: prompt.system,
            messages: prompt.messages.map(m => ({
                role: m.role === "system" ? "user" as const : m.role as "user" | "assistant",
                content: m.content,
            })),
            nativeTools: prompt.tools.length > 0 ? prompt.tools : undefined,
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },

    // Native FC — tool calls are parsed by the provider, not the strategy
}
