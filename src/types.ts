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
    temperature?: number
    maxTokens?: number
    strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"
}

// ── LLM response types ──

export interface ToolCall {
    name: string
    args: Record<string, any>
}

export interface LLMResponse {
    text: string
    toolCalls: ToolCall[]
    raw: any
    usage?: {
        inputTokens: number
        outputTokens: number
    }
}

// ── Strategy interface ──

export interface RenderStrategy {
    name: string
    /** Build the API request body from extracted prompt data */
    buildRequest(prompt: ExtractedPrompt, apiKey: string): {
        url: string
        body: any
        headers: Record<string, string>
    }
    /** Parse the API response into a structured LLMResponse */
    parseResponse(data: any): LLMResponse
}
