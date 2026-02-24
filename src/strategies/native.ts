// ── Native Function Calling Strategy ──
// Tools go into the API's `tools` field as structured declarations.
// This is the optimal strategy — 17x fewer output tokens, 2x faster latency.

import type { RenderStrategy, ExtractedPrompt, LLMResponse } from "../types"

function resolveGeminiEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

export const native: RenderStrategy = {
    name: "native",

    buildRequest(prompt: ExtractedPrompt, apiKey: string) {
        const model = prompt.model || "gemini-2.5-flash"

        // Build function declarations from extracted tools
        const functionDeclarations = prompt.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }))

        // Build contents from messages
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

        // System instruction
        if (prompt.system) {
            body.systemInstruction = { parts: [{ text: prompt.system }] }
        }

        // Tools via native API field
        if (functionDeclarations.length > 0) {
            body.tools = [{ functionDeclarations }]
            body.toolConfig = { functionCallingConfig: { mode: "AUTO" } }
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
        const toolCalls: LLMResponse["toolCalls"] = []
        let text = ""

        const parts = data.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
            if (part.text) text += part.text
            if (part.functionCall) {
                toolCalls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args || {},
                })
            }
        }

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
