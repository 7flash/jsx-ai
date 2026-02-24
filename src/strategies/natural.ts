// ── Natural Language Strategy ──
// Tools and prompt structure are described in plain conversational English.
// No XML tags, no structured JSON — just clear natural language instructions.
// The model responds in natural language with a specific pattern we parse.

import type { RenderStrategy, ExtractedPrompt, PreparedPrompt, ProviderResponse, ToolCall } from "../types"

/** Convert tools into natural language instructions */
function toolsToNaturalLanguage(tools: ExtractedPrompt["tools"]): string {
    if (tools.length === 0) return ""

    const toolDescriptions = tools.map(t => {
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

/** Parse TOOL_CALL blocks from response text */
function parseNaturalToolCalls(text: string): ToolCall[] {
    const calls: ToolCall[] = []

    const callRegex = /TOOL_CALL:\s*(\S+)\s*\n([\s\S]*?)END_CALL/g
    let match
    while ((match = callRegex.exec(text)) !== null) {
        const name = match[1].trim()
        const body = match[2]
        const args: Record<string, any> = {}

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

    prepare(prompt: ExtractedPrompt): PreparedPrompt {
        const systemParts: string[] = []
        if (prompt.system) systemParts.push(prompt.system)
        systemParts.push(toolsToNaturalLanguage(prompt.tools))

        return {
            system: systemParts.join("\n\n"),
            messages: prompt.messages.map(m => ({
                role: m.role === "system" ? "user" as const : m.role as "user" | "assistant",
                content: m.content,
            })),
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },

    parseResponse(response: ProviderResponse) {
        const text = response.text

        // Extract thinking section
        const thinkMatch = text.match(/THINKING:\s*([\s\S]*?)(?=\nTOOL_CALL:|$)/)
        const thinking = thinkMatch ? thinkMatch[1].trim() : text.split("TOOL_CALL:")[0].trim()

        return {
            text: thinking,
            toolCalls: parseNaturalToolCalls(text),
        }
    },
}
