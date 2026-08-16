// ── JSX-AI Node Types ──
// The virtual tree produced by JSX before rendering to an API request.

export type BuiltinProviderName = "gemini" | "openai" | "anthropic";
export type ProviderName = BuiltinProviderName | (string & {});
export type BuiltinStrategyName =
  "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto";
export type StrategyName = BuiltinStrategyName | (string & {});

export interface ToolCall {
  /** Provider tool-call identifier when the protocol supplies one. */
  id?: string;
  name: string;
  args: Record<string, any>;
}

export type JsxAiNode =
  | ToolNode
  | ParamNode
  | MessageNode
  | SystemNode
  | PromptNode
  | TextNode
  | FragmentNode;

export interface ToolNode {
  type: "tool";
  props: {
    name: string;
    description: string;
    children?: JsxAiNode | JsxAiNode[];
  };
}

export interface ParamNode {
  type: "param";
  props: {
    name: string;
    type?: string;
    required?: boolean;
    enum?: string[];
    children?: string;
  };
}

/**
 * A message can preserve native tool history instead of flattening it to prose.
 *
 * Assistant tool call:
 *   <message role="assistant" toolCalls={result.toolCalls}>{result.text}</message>
 *
 * Tool result:
 *   <message role="tool" toolCallId={call.id} toolName={call.name}>ok</message>
 */
export interface MessageNode {
  type: "message";
  props: {
    role: "user" | "assistant" | "tool";
    toolCalls?: ToolCall[];
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    children?: JsxAiNode | JsxAiNode[] | string;
  };
}

export interface SystemNode {
  type: "system";
  props: {
    children?: JsxAiNode | JsxAiNode[] | string;
  };
}

export interface PromptNode {
  type: "prompt";
  props: {
    model?: string;
    provider?: ProviderName;
    temperature?: number;
    maxTokens?: number;
    strategy?: StrategyName;
    children?: JsxAiNode | JsxAiNode[];
  };
}

export interface TextNode {
  type: "text";
  value: string;
}

export interface FragmentNode {
  type: "fragment";
  children: JsxAiNode[];
}

// ── Canonical prompt IR ──

export interface ExtractedTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

export interface ExtractedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool result messages. Required by OpenAI/Anthropic native history. */
  toolCallId?: string;
  /** Tool name for tool results. Required by Gemini functionResponse history. */
  toolName?: string;
  isError?: boolean;
}

export interface ExtractedPrompt {
  tools: ExtractedTool[];
  messages: ExtractedMessage[];
  system?: string;
  model?: string;
  providerOverride?: ProviderName;
  temperature?: number;
  maxTokens?: number;
  strategy?: StrategyName;
}

// ── Provider-agnostic prepared prompt ──

export interface PreparedPrompt {
  system?: string;
  messages: ExtractedMessage[];
  /** Structured tool declarations for native FC strategies (native, hybrid). */
  nativeTools?: ExtractedTool[];
  temperature?: number;
  maxTokens?: number;
}

// ── LLM response types ──

export interface ProviderResponse {
  text: string;
  nativeToolCalls: ToolCall[];
  raw: any;
  finishReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  raw: any;
  /** Canonical request data is included so logs do not need provider-specific introspection. */
  request?: { url: string; body: any; prepared: PreparedPrompt };
  finishReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
}

// ── Strategy interface ──

export interface RenderStrategy {
  name: string;
  prepare(prompt: ExtractedPrompt): PreparedPrompt;
  /** The canonical prompt is supplied for parsers that need declared tool metadata. */
  parseResponse(
    response: ProviderResponse,
    prompt?: ExtractedPrompt,
  ): { text: string; toolCalls: ToolCall[] };
}
