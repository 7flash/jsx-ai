// ── Natural Language Strategy ──
// Tools and prompt structure are described in plain conversational English.
// No XML tags, no structured JSON — just clear natural language instructions.
// The model responds in natural language with a specific pattern we parse.

import type { RenderStrategy, ExtractedPrompt, LLMResponse } from "../types"

function resolveGeminiEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

/** Convert tools into natural language instructions */
function toolsToNaturalLanguage(prompt: ExtractedPrompt): string {
    if (prompt.tools.length === 0) return ""

    const toolDescriptions = prompt.tools.map(t => {
        const params = Object.entries(t.parameters.properties)
            .map(([name, p]) => {
                const req = t.parameters.required.includes(name) ? "" : " (optional)"
                return `  - "${name}"${req}: ${p.description}`
            })
            .join("\n")
        return `• ${t.name} — ${t.description}\n  Parameters:\n${params}`
    }).join("\n\n")

    return `You have the following tools available to you:

${toolDescriptions}

When you want to use a tool, write your response in this exact format:

THINKING: [your reasoning about what to do]

TOOL_CALL: tool_name
PARAM key1: value1
PARAM key2: value2
END_CALL

You can make multiple tool calls in one response. Each one should follow the TOOL_CALL format above.
If you don't need any tools, just respond with THINKING and your message.`
}

/** Parse natural language tool calls from the model's response */
function parseNaturalLanguageResponse(text: string): LLMResponse["toolCalls"] {
    const calls: LLMResponse["toolCalls"] = []

    // Match TOOL_CALL blocks
    const callRegex = /TOOL_CALL:\s*(\S+)\s*\n([\s\S]*?)END_CALL/g
    let match
    while ((match = callRegex.exec(text)) !== null) {
        const name = match[1].trim()
        const body = match[2]
        const args: Record<string, any> = {}

        // Parse PARAM lines
        const paramRegex = /PARAM\s+(\w+):\s*([\s\S]*?)(?=\nPARAM\s|\nEND_CALL|$)/g
        let pm
        while ((pm = paramRegex.exec(body)) !== null) {
            args[pm[1].trim()] = pm[2].trim()
        }

        calls.push({ name, args })
    }

    return calls
}

export const natural: RenderStrategy = {
    name: "natural",

    buildRequest(prompt: ExtractedPrompt, apiKey: string) {
        const model = prompt.model || "gemini-2.5-flash"

        const systemParts: string[] = []
        if (prompt.system) systemParts.push(prompt.system)
        systemParts.push(toolsToNaturalLanguage(prompt))

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
        // Concatenate ALL text parts (Gemini may split response across multiple parts)
        const parts = data.candidates?.[0]?.content?.parts || []
        const text = parts
            .filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("\n")

        // Extract thinking section
        const thinkMatch = text.match(/THINKING:\s*([\s\S]*?)(?=\nTOOL_CALL:|$)/)
        const thinking = thinkMatch ? thinkMatch[1].trim() : text.split("TOOL_CALL:")[0].trim()

        const usage = data.usageMetadata
        return {
            text: thinking,
            toolCalls: parseNaturalLanguageResponse(text),
            raw: data,
            usage: usage ? {
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
            } : undefined,
        }
    },
}
