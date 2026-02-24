// ── Hybrid Strategy ──
// Best of both worlds: Native FC for structured tool calling (lowest tokens, 
// highest 1st-tool accuracy) + natural language system prompt style (better
// reasoning and multi-tool batching hints).
//
// Benchmark rationale:
//   Native FC:  100% 1st-tool accuracy, 46 avg output tokens, 1272ms
//   Natural:    80% all-tool match, 90 avg output tokens, 1488ms
//   Hybrid:     Structured tool schemas + conversational prompt = best combo

import type { RenderStrategy, ExtractedPrompt, LLMResponse } from "../types"

function resolveGeminiEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

export const hybrid: RenderStrategy = {
    name: "hybrid",

    buildRequest(prompt: ExtractedPrompt, apiKey: string) {
        const model = prompt.model || "gemini-2.5-flash"

        // Tools go in the structured native FC field (best accuracy, lowest tokens)
        const tools = prompt.tools.length > 0 ? [{
            functionDeclarations: prompt.tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: {
                    type: "object",
                    properties: Object.fromEntries(
                        Object.entries(t.parameters.properties).map(([name, p]) => [
                            name,
                            { type: p.type || "string", description: p.description },
                        ])
                    ),
                    required: t.parameters.required,
                },
            })),
        }] : undefined

        // System prompt is conversational (not XML boilerplate)
        const systemParts: string[] = []
        if (prompt.system) systemParts.push(prompt.system)

        // Add behavioral hints that improve multi-tool batching
        if (prompt.tools.length > 0) {
            systemParts.push(
                `You can invoke multiple tools in a single turn when the task requires it. ` +
                `Think through what tools you need, then call them all at once.`
            )
        }

        const contents = prompt.messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        }))

        const body: any = {
            contents,
            generationConfig: {
                temperature: prompt.temperature ?? 0.1,
                maxOutputTokens: prompt.maxTokens ?? 4000,
            },
        }

        if (systemParts.length > 0) {
            body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] }
        }

        if (tools) {
            body.tools = tools
            body.toolConfig = {
                functionCallingConfig: { mode: "AUTO" },
            }
        }

        return {
            url: resolveGeminiEndpoint(model),
            body,
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
        }
    },

    parseResponse(data: any): LLMResponse {
        // Same as native — parse structured function calls
        const parts = data.candidates?.[0]?.content?.parts || []
        const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("")
        const toolCalls = parts
            .filter((p: any) => p.functionCall)
            .map((p: any) => ({
                name: p.functionCall.name,
                args: p.functionCall.args || {},
            }))

        const usage = data.usageMetadata
        return {
            text,
            toolCalls,
            raw: data,
            usage: usage ? {
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
            } : undefined,
        }
    },
}
