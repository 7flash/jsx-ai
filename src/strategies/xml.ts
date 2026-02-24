// ── XML Strategy ──
// Everything is XML: system prompt, tools, messages — the entire prompt is one XML document.
// The model responds with XML that we parse.
// This gives the LLM maximum structure to work with.

import type { RenderStrategy, ExtractedPrompt, PreparedPrompt, ToolCall } from "../types"

/** Build the full XML prompt document — system, tools, and conversation */
function buildXMLDocument(prompt: ExtractedPrompt): string {
    const parts: string[] = []

    parts.push(`<prompt>`)

    // System instruction
    if (prompt.system) {
        parts.push(`  <system>${prompt.system}</system>`)
    }

    // Tools
    if (prompt.tools.length > 0) {
        parts.push(`  <tools>`)
        for (const t of prompt.tools) {
            parts.push(`    <tool name="${t.name}" description="${escapeXml(t.description)}">`)
            for (const [name, p] of Object.entries(t.parameters.properties)) {
                const req = t.parameters.required.includes(name) ? ` required="true"` : ``
                const enumAttr = p.enum ? ` enum="${p.enum.join(',')}"` : ``
                parts.push(`      <param name="${name}" type="${p.type}"${req}${enumAttr}>${escapeXml(p.description)}</param>`)
            }
            parts.push(`    </tool>`)
        }
        parts.push(`  </tools>`)
    }

    // Conversation messages
    if (prompt.messages.length > 0) {
        parts.push(`  <messages>`)
        for (const m of prompt.messages) {
            parts.push(`    <message role="${m.role}">${escapeXml(m.content)}</message>`)
        }
        parts.push(`  </messages>`)
    }

    // Response format instruction
    parts.push(`  <response_format>`)
    parts.push(`    Respond ONLY with valid XML in this format:`)
    parts.push(`    <response>`)
    parts.push(`      <message>Your reasoning and explanation</message>`)
    parts.push(`      <tool_calls>`)
    parts.push(`        <call tool="tool_name">`)
    parts.push(`          <param name="param_name">value</param>`)
    parts.push(`        </call>`)
    parts.push(`      </tool_calls>`)
    parts.push(`    </response>`)
    parts.push(`  </response_format>`)

    parts.push(`</prompt>`)

    return parts.join("\n")
}

/** Escape XML special characters */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

export const xml: RenderStrategy = {
    name: "xml",

    prepare(prompt: ExtractedPrompt): PreparedPrompt {
        // The entire prompt is one XML document — sent as a single user message
        const xmlDocument = buildXMLDocument(prompt)

        return {
            // No system — everything is in the XML document
            messages: [{ role: "user", content: xmlDocument }],
            // No native tools — tools are embedded in XML
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },

    parseToolCalls(text: string): ToolCall[] {
        const calls: ToolCall[] = []

        // Match <call tool="name">...</call> blocks
        const callRegex = /<call\s+tool="([^"]+)">([\s\S]*?)<\/call>/g
        let match
        while ((match = callRegex.exec(text)) !== null) {
            const toolName = match[1].trim()
            const body = match[2]
            const args: Record<string, any> = {}

            // Parse <param name="key">value</param>
            const paramRegex = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g
            let pm
            while ((pm = paramRegex.exec(body)) !== null) {
                args[pm[1].trim()] = pm[2].trim()
            }
            calls.push({ name: toolName, args })
        }

        // Fallback: legacy <invocation> format
        if (calls.length === 0) {
            const invocationRegex = /<invocation>([\s\S]*?)<\/invocation>/g
            while ((match = invocationRegex.exec(text)) !== null) {
                const block = match[1]
                const toolMatch = block.match(/<tool>([\s\S]*?)<\/tool>/)
                const paramsMatch = block.match(/<params>([\s\S]*?)<\/params>/)

                if (toolMatch) {
                    const args: Record<string, any> = {}
                    if (paramsMatch) {
                        const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
                        let pm
                        while ((pm = paramRegex.exec(paramsMatch[1])) !== null) {
                            args[pm[1]] = pm[2].trim()
                        }
                    }
                    calls.push({ name: toolMatch[1].trim(), args })
                }
            }
        }

        return calls
    },
}
