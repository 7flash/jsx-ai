// ── Custom JSX Runtime for jsx-ai ──
// This replaces React's createElement — every <tag> becomes a JsxAiNode
//
// Also exports `md` — a dedent tagged template for clean multi-line text in JSX:
//   <system>{md`
//       You are an expert.
//       - Rule one
//       - Rule two
//   `}</system>

import type { JsxAiNode } from "./types"

// Component function type
type Component = (props: any) => JsxAiNode

/**
 * JSX factory — called by the transpiler for every JSX element.
 * 
 * <tool name="exec" description="Run a command">  →  jsx("tool", { name: "exec", description: "..." })
 * <MyComponent foo="bar" />                        →  jsx(MyComponent, { foo: "bar" })
 */
export function jsx(
    tag: string | Component,
    props: Record<string, any>,
): JsxAiNode {
    // Function component — call it and return its output
    if (typeof tag === "function") {
        return tag(props)
    }

    // Normalize children 
    const { children, ...rest } = props
    const normalizedChildren = normalizeChildren(children)

    // Built-in tags map to node types
    switch (tag) {
        case "tool":
            return { type: "tool", props: { ...rest, children: normalizedChildren } } as any
        case "param":
            return { type: "param", props: { ...rest, children: extractText(normalizedChildren) } } as any
        case "message":
            return { type: "message", props: { ...rest, children: normalizedChildren } } as any
        case "system":
            return { type: "system", props: { ...rest, children: normalizedChildren } } as any
        case "prompt":
            return { type: "prompt", props: { ...rest, children: normalizedChildren } } as any
        default:
            // Unknown tags become fragments with a text label
            return { type: "fragment", children: Array.isArray(normalizedChildren) ? normalizedChildren : normalizedChildren ? [normalizedChildren] : [] }
    }
}

/** jsxs — same as jsx but for static children (React 17+ automatic runtime) */
export const jsxs = jsx

/** Fragment support: <></> becomes a FragmentNode */
export function Fragment(props: { children?: any }): JsxAiNode {
    const children = normalizeChildren(props.children)
    return {
        type: "fragment",
        children: Array.isArray(children) ? children : children ? [children] : [],
    }
}

// ── Helpers ──

function normalizeChildren(children: any): JsxAiNode | JsxAiNode[] | undefined {
    if (children == null) return undefined
    if (typeof children === "string") return { type: "text" as const, value: children }
    if (typeof children === "number") return { type: "text" as const, value: String(children) }
    if (Array.isArray(children)) {
        return children.flatMap(c => {
            if (c == null || c === false) return []
            if (typeof c === "string") return [{ type: "text" as const, value: c }]
            if (typeof c === "number") return [{ type: "text" as const, value: String(c) }]
            if (Array.isArray(c)) return c
            return [c]
        })
    }
    return children as JsxAiNode
}

function extractText(children: JsxAiNode | JsxAiNode[] | undefined): string | undefined {
    if (!children) return undefined
    if (!Array.isArray(children)) {
        return children.type === "text" ? children.value : undefined
    }
    return children
        .filter((c): c is { type: "text"; value: string } => c.type === "text")
        .map(c => c.value)
        .join("")
}

// ── Dedent tagged template ──

/**
 * Dedent tagged template — strips common leading indentation from multi-line text.
 * Use inside JSX tags where plain text would lose newlines:
 *
 *   <system>{md`
 *       You are an expert developer.
 *       - Use clean architecture
 *       - Write tests for everything
 *   `}</system>
 */
export function md(strings: TemplateStringsArray, ...values: any[]): string {
    // Interpolate template
    let text = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")

    // Split into lines, remove first/last empty lines
    const lines = text.split("\n")
    if (lines[0]!.trim() === "") lines.shift()
    if (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()

    // Find minimum indentation (ignoring empty lines)
    const indent = lines
        .filter(l => l.trim().length > 0)
        .reduce((min, l) => {
            const spaces = l.match(/^(\s*)/)?.[1]?.length ?? 0
            return Math.min(min, spaces)
        }, Infinity)

    // Strip common indent
    return (indent === Infinity ? lines : lines.map(l => l.slice(indent))).join("\n")
}

// ── JSX namespace for TypeScript ──
declare global {
    namespace JSX {
        interface IntrinsicElements {
            tool: { name: string; description: string; children?: any }
            param: { name: string; type?: string; required?: boolean; enum?: string[]; children?: any }
            message: { role: "user" | "assistant" | "tool"; children?: any }
            system: { children?: any }
            prompt: { model?: string; temperature?: number; maxTokens?: number; strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"; children?: any }
        }
        type Element = JsxAiNode
    }
}
