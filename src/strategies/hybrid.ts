// ── Hybrid Strategy ──
// Best of both worlds: Native FC for structured tool calling (lowest tokens,
// highest 1st-tool accuracy) + natural language system prompt hints (better
// reasoning and multi-tool batching).

import type { RenderStrategy, ExtractedPrompt, PreparedPrompt, ProviderResponse } from "../types"

export const hybrid: RenderStrategy = {
    name: "hybrid",

    prepare(prompt: ExtractedPrompt): PreparedPrompt {
        // System prompt is conversational + behavioral hints
        const systemParts: string[] = []
        if (prompt.system) systemParts.push(prompt.system)

        // Add behavioral hints that improve multi-tool batching
        if (prompt.tools.length > 0) {
            systemParts.push(
                `You can invoke multiple tools in a single turn when the task requires it. ` +
                `Think through what tools you need, then call them all at once.`
            )
        }

        return {
            system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
            messages: prompt.messages.map(m => ({
                role: m.role === "system" ? "user" as const : m.role as "user" | "assistant",
                content: m.content,
            })),
            nativeTools: prompt.tools.length > 0 ? prompt.tools : undefined,
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },

    parseResponse(response: ProviderResponse) {
        // Hybrid uses native FC — pass through the provider's structured calls
        return {
            text: response.text,
            toolCalls: response.nativeToolCalls,
        }
    },
}
