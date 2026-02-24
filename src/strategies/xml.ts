// ── XML Strategy ──
// Everything is XML: system prompt, tools, messages — the entire prompt is one XML document.
// The model responds with XML that we parse.
// This gives the LLM maximum structure to work with.

import type { RenderStrategy, ExtractedPrompt, LLMResponse } from "../types"

function resolveGeminiEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

/** Build the full XML prompt document — system, tools, and conversation */
function buildXMLPrompt(prompt: ExtractedPrompt): string {
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

/** Minimal XML parser — extracts tool calls from the model's XML response */
function parseXMLToolCalls(text: string): LLMResponse["toolCalls"] {
    const calls: LLMResponse["toolCalls"] = []

    // Match <call tool="name">...</call> blocks (new format)
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
}

/** Concatenate all text parts from a Gemini response */
function collectResponseText(data: any): string {
    const parts = data.candidates?.[0]?.content?.parts || []
    return parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("\n")
}

export const xml: RenderStrategy = {
    name: "xml",

    buildRequest(prompt: ExtractedPrompt, apiKey: string) {
        const model = prompt.model || "gemini-2.5-flash"

        // The entire prompt is one XML document — sent as the user message
        const xmlPrompt = buildXMLPrompt(prompt)

        const body: any = {
            contents: [{
                role: "user",
                parts: [{ text: xmlPrompt }],
            }],
            generationConfig: {
                temperature: prompt.temperature ?? 0.1,
                maxOutputTokens: prompt.maxTokens ?? 4000,
            },
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
        const text = collectResponseText(data)

        // Extract message from <message> tag
        const msgMatch = text.match(/<message>([\s\S]*?)<\/message>/)
        const message = msgMatch ? msgMatch[1].trim() : text.replace(/<[^>]+>/g, "").trim()

        const usage = data.usageMetadata
        return {
            text: message,
            toolCalls: parseXMLToolCalls(text),
            raw: data,
            usage: usage ? {
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
            } : undefined,
        }
    },
}
