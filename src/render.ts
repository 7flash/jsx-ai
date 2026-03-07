// ── Tree Renderer ──
// Walks the JSX virtual tree and extracts structured prompt data

import type { JsxAiNode, ExtractedPrompt, ExtractedTool, ExtractedMessage } from "./types"

/**
 * Extract structured prompt data from a JSX tree.
 * 
 * Given: <prompt model="gemini-2.5-flash">
 *          <system>You are helpful</system>
 *          <tool name="exec" ...><param .../></tool>
 *          <message role="user">Do something</message>
 *        </prompt>
 * 
 * Returns: { model, system, tools: [...], messages: [...] }
 */
export function extract(node: JsxAiNode): ExtractedPrompt {
    const result: ExtractedPrompt = {
        tools: [],
        messages: [],
    }

    walk(node, result)
    return result
}

function walk(node: JsxAiNode, result: ExtractedPrompt): void {
    if (!node) return

    switch (node.type) {
        case "prompt":
            if (node.props.model) result.model = node.props.model
            if (node.props.temperature != null) result.temperature = node.props.temperature
            if (node.props.maxTokens != null) result.maxTokens = node.props.maxTokens
            if (node.props.strategy) result.strategy = node.props.strategy
            walkChildren(node.props.children, result)
            break

        case "tool":
            result.tools.push(extractTool(node))
            break

        case "message":
            result.messages.push(extractMessage(node))
            break

        case "system": {
            const text = collectText(node.props.children)
            result.system = result.system ? result.system + "\n\n" + text : text
            break
        }

        case "fragment":
            for (const child of node.children) {
                walk(child, result)
            }
            break

        case "text":
            // Top-level text is ignored (must be inside a <message> or <system>)
            break

        case "param":
            // Params are only meaningful inside <tool>, handled by extractTool
            break
    }
}

function walkChildren(children: JsxAiNode | JsxAiNode[] | undefined, result: ExtractedPrompt): void {
    if (!children) return
    if (Array.isArray(children)) {
        for (const child of children) walk(child, result)
    } else {
        walk(children, result)
    }
}

function extractTool(node: JsxAiNode & { type: "tool" }): ExtractedTool {
    const properties: Record<string, { type: string; description: string; enum?: string[] }> = {}
    const required: string[] = []

    const children = node.props.children
    const paramNodes = collectNodes(children, "param")

    for (const param of paramNodes) {
        if (param.type !== "param") continue
        const p = (param as JsxAiNode & { type: "param" }).props as any
        const entry: { type: string; description: string; enum?: string[] } = {
            type: p.type || "string",
            description: p.children || "",
        }
        if (p.enum) entry.enum = p.enum
        properties[p.name] = entry
        if (p.required) required.push(p.name)
    }

    return {
        name: node.props.name,
        description: node.props.description,
        parameters: {
            type: "object",
            properties,
            required,
        },
    }
}

function extractMessage(node: JsxAiNode & { type: "message" }): ExtractedMessage {
    return {
        role: node.props.role,
        content: collectText(node.props.children),
    }
}

// ── Helper utilities ──

/** Collect all text content from a node tree */
function collectText(children: JsxAiNode | JsxAiNode[] | string | undefined): string {
    if (!children) return ""
    if (typeof children === "string") return children

    if (!Array.isArray(children)) {
        if (children.type === "text") return children.value
        return ""
    }

    return children
        .map(c => {
            if (typeof c === "string") return c
            if (c.type === "text") return c.value
            return ""
        })
        .join("")
        .trim()
}

/** Collect all child nodes of a specific type */
function collectNodes(children: JsxAiNode | JsxAiNode[] | undefined, type: string): JsxAiNode[] {
    if (!children) return []
    if (!Array.isArray(children)) {
        return children.type === type ? [children] : []
    }
    return children.filter(c => c.type === type)
}
