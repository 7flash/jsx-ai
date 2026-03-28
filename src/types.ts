// ── JSX-AI Node Types ──
// The virtual tree produced by JSX before rendering to an API request

export type JsxAiNode =
    | ToolNode
    | ParamNode
    | MessageNode
    | SystemNode
    | PromptNode
    | TextNode
    | FragmentNode

export interface ToolNode {
    type: "tool"
    props: {
        name: string
        description: string
        children?: JsxAiNode | JsxAiNode[]
    }
}

export interface ParamNode {
    type: "param"
    props: {
        name: string
        type?: string
        required?: boolean
        enum?: string[]
        children?: string  // description text
    }
}

export interface MessageNode {
    type: "message"
    props: {
        role: "user" | "assistant" | "tool"
        children?: JsxAiNode | JsxAiNode[] | string
    }
}

export interface SystemNode {
    type: "system"
    props: {
        children?: JsxAiNode | JsxAiNode[] | string
    }
}

export interface PromptNode {
    type: "prompt"
    props: {
        model?: string
        provider?: string
        temperature?: number
        maxTokens?: number
        strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"
        children?: JsxAiNode | JsxAiNode[]
    }
}

export interface TextNode {
    type: "text"
    value: string
}

export interface FragmentNode {
    type: "fragment"
    children: JsxAiNode[]
}

// ── Extracted structured data from the tree ──

export interface ExtractedTool {
    name: string
    description: string
    parameters: {
        type: "object"
        properties: Record<string, {
            type: string
            description: string
            enum?: string[]
        }>
        required: string[]
    }
}

export interface ExtractedMessage {
    role: "user" | "assistant" | "system" | "tool"
    content: string
}

export interface ExtractedPrompt {
    tools: ExtractedTool[]
    messages: ExtractedMessage[]
    system?: string
    model?: string
    provider?: string
    temperature?: number
    maxTokens?: number
    strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"
}

// ── Provider-agnostic prepared prompt ──
// This is what a strategy produces — no Gemini/OpenAI specifics.

export interface PreparedPrompt {
    system?: string
    messages: { role: "user" | "assistant"; content: string }[]
    /** Structured tool declarations for native FC strategies (native, hybrid) */
    nativeTools?: ExtractedTool[]
    temperature?: number
    maxTokens?: number
}

// ── LLM response types ──

export interface ToolCall {
    name: string
    args: Record<string, any>
}

/** Provider-normalized response — what the provider hands to the strategy */
export interface ProviderResponse {
    /** All text content from the response */
    text: string
    /** Tool calls extracted by the provider's native FC mechanism (if any) */
    nativeToolCalls: ToolCall[]
    /** Raw API response for logging/debugging */
    raw: any
    usage?: {
        inputTokens: number
        outputTokens: number
        thinkingTokens?: number
    }
}

export interface LLMResponse {
    text: string
    toolCalls: ToolCall[]
    raw: any
    request?: { url: string; body: any }
    usage?: {
        inputTokens: number
        outputTokens: number
        thinkingTokens?: number
    }
}

// ── Strategy interface ──
// Strategies are PROVIDER-AGNOSTIC. They transform the prompt shape
// and parse the response — but never build API-specific bodies.

export interface RenderStrategy {
    name: string
    /** Transform extracted prompt into provider-agnostic prepared prompt */
    prepare(prompt: ExtractedPrompt): PreparedPrompt
    /** Parse the normalized provider response into text + tool calls */
    parseResponse(response: ProviderResponse): { text: string; toolCalls: ToolCall[] }
}
