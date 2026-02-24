// ── NLT (Natural Language Tools) Strategy ──
//
// Based on the NLT paper (Pain & West, 2025): instead of JSON function
// calling, the model lists every available tool with a YES/NO decision.
//
// Key insights from the paper:
//   - Full-catalog YES/NO eliminates positional bias
//   - Explicit thinking step improves selection quality
//   - 18.4pp accuracy gain over structured tool calling across 6,400 trials
//   - 70% variance reduction
//
// For parameterized tools we extend the paper's approach:
//   Selected tools (YES) include their arguments inline.
//
// Paper format (parameterless):
//   Thinking: [reasoning]
//   Website Information – YES
//   Talk to a Human – NO
//   Past Purchases – YES
//   Assessment finished.
//
// Our adaptation (with params):
//   Thinking: [reasoning]
//
//   write_file – YES
//   path: src/db.ts
//   content: [file content]
//
//   edit_file – NO
//
//   exec – NO
//
//   Assessment finished.

import type { RenderStrategy, ExtractedPrompt, PreparedPrompt, ProviderResponse, ToolCall } from "../types"

/** Build NLT-style system prompt following the paper's 5-component template */
function buildNLTSystemPrompt(prompt: ExtractedPrompt): string {
    const parts: string[] = []

    // {NLT-role} — grounding context
    if (prompt.system) {
        parts.push(prompt.system)
    }

    // {Search-purpose} — explicit tool-calling motive
    parts.push(
        `Your mission is to determine which tools should be used to accomplish the task, ` +
        `and provide the required arguments for each selected tool.`
    )

    // {Tool-list} — natural language descriptions
    if (prompt.tools.length > 0) {
        const toolDescriptions = prompt.tools.map(t => {
            const params = Object.entries(t.parameters.properties)
                .map(([name, p]) => {
                    const req = t.parameters.required.includes(name) ? " (required)" : " (optional)"
                    return `    ${name}${req}: ${p.description}`
                })
                .join("\n")
            return `${t.name}: ${t.description}\n  Parameters:\n${params}`
        }).join("\n\n")

        parts.push(`Your list of available tools:\n\n${toolDescriptions}`)
    }

    // {Output-description} — parsable format in natural language
    parts.push(
        `Your output should begin by thinking through which tools are needed and why. ` +
        `Then, list EVERY available tool followed by either YES or NO.\n\n` +
        `For tools marked YES, include each parameter on its own line as "param_name: value".\n` +
        `For tools marked NO, just write the tool name and NO.\n\n` +
        `If a tool is called multiple times, repeat its YES block for each invocation.\n\n` +
        `End with "Assessment finished."`
    )

    // {Output-example} — explicit example
    if (prompt.tools.length > 0) {
        const exampleLines: string[] = ["It should always be in the following format:\n"]
        exampleLines.push("Thinking: (your reasoning about which tools to use and why)\n")

        for (const t of prompt.tools) {
            const paramNames = Object.keys(t.parameters.properties)
            exampleLines.push(`${t.name} – YES/NO`)
            if (paramNames.length > 0) {
                exampleLines.push(`(if YES, include:)`)
                for (const p of paramNames) {
                    exampleLines.push(`${p}: (value)`)
                }
            }
            exampleLines.push("")
        }
        exampleLines.push("Assessment finished.")
        parts.push(exampleLines.join("\n"))
    }

    return parts.join("\n\n")
}

/**
 * Parse NLT YES/NO output with inline parameters.
 *
 * The model outputs something like:
 *   write_file – YES
 *   path: src/db.ts
 *   content: import { Database } from "bun:sqlite"
 *   ... (hundreds of lines of code)
 *   write_file – YES
 *   path: src/server.ts
 *   content: ...
 *   edit_file – NO
 *   exec – NO
 *   Assessment finished.
 *
 * The tricky part: `content:` values contain lines that look like param names
 * (e.g., `port: 3000`, `status: 200`). So we can't greedily split on `key:`.
 * Instead, for each YES block we use the KNOWN param names and split using
 * the tool boundary markers (next "toolname – YES/NO" or "Assessment finished.").
 */
function parseNLTToolCalls(text: string): ToolCall[] {
    const calls: ToolCall[] = []

    // Detect tool names from the YES/NO pattern
    const toolNameRegex = /^(\S+)\s*[–—:-]\s*(YES|NO)\b/gm
    const detectedTools: string[] = []
    let m
    while ((m = toolNameRegex.exec(text)) !== null) {
        if (!detectedTools.includes(m[1])) {
            detectedTools.push(m[1])
        }
    }

    // Build boundary pattern: matches any "toolname – YES/NO" or "Assessment finished."
    const toolMarkers = detectedTools.map(escapeRegex)
    if (toolMarkers.length === 0) return calls

    const boundaryPattern = `(?:(?:${toolMarkers.join("|")})\\s*[–—:-]\\s*(?:YES|NO)|Assessment\\s+finished)`

    // Find all YES blocks: "toolname – YES" + everything until next boundary
    const yesBlockRegex = new RegExp(
        `(${toolMarkers.join("|")})\\s*[–—:-]\\s*YES\\b([\\s\\S]*?)(?=${boundaryPattern}|$)`,
        "gi"
    )

    let match
    while ((match = yesBlockRegex.exec(text)) !== null) {
        const toolName = match[1]
        const block = match[2]
        const args = parseBlockParams(block)
        calls.push({ name: toolName, args })
    }

    return calls
}

/**
 * Parse parameter values from a YES block.
 *
 * For tools with a large text param (like "content"), we use a positional
 * approach: find params from the top, and for the LAST param treat everything
 * until end-of-block as its value.
 */
function parseBlockParams(block: string): Record<string, any> {
    const args: Record<string, any> = {}
    const lines = block.split("\n")

    // Collect param candidates
    const paramStarts: { key: string; valueStart: string; lineIndex: number }[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const m = line.match(/^([a-z_]+):\s*(.*)/)
        if (m) {
            const key = m[1]

            // If the last param was a multi-line content param, stop looking
            if (paramStarts.length > 0) {
                const lastParam = paramStarts[paramStarts.length - 1]
                if (lastParam.key === "content" || lastParam.key === "replace") {
                    continue
                }
            }

            paramStarts.push({ key, valueStart: m[2], lineIndex: i })
        }
    }

    // Extract values
    for (let i = 0; i < paramStarts.length; i++) {
        const param = paramStarts[i]
        const nextParam = paramStarts[i + 1]

        if (nextParam) {
            const valueLines = [param.valueStart]
            for (let j = param.lineIndex + 1; j < nextParam.lineIndex; j++) {
                valueLines.push(lines[j])
            }
            args[param.key] = valueLines.join("\n").trim()
        } else {
            // Last param — value is everything until end of block
            const valueLines = [param.valueStart]
            for (let j = param.lineIndex + 1; j < lines.length; j++) {
                valueLines.push(lines[j])
            }
            args[param.key] = valueLines.join("\n").trim()
        }
    }

    return args
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const nlt: RenderStrategy = {
    name: "nlt",

    prepare(prompt: ExtractedPrompt): PreparedPrompt {
        // Tools are embedded in the system prompt as NLT YES/NO format
        return {
            system: buildNLTSystemPrompt(prompt),
            messages: prompt.messages.map(m => ({
                role: m.role === "system" ? "user" as const : m.role as "user" | "assistant",
                content: m.content,
            })),
            // No native tools — tools are in the system prompt text
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },

    parseResponse(response: ProviderResponse) {
        return {
            text: response.text,
            toolCalls: parseNLTToolCalls(response.text),
        }
    },
}
