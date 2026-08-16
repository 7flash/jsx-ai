// ── JSX-AI public and canonical types ──

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonSchemaType =
  "null" | "boolean" | "object" | "array" | "number" | "integer" | "string";

/**
 * Provider-neutral JSON Schema representation used by tool definitions.
 *
 * The runtime validates this subset recursively and freezes the normalized schema.
 * It intentionally covers the portable schema keywords used by current tool APIs
 * instead of exposing provider-specific schema extensions in the canonical IR.
 */
export interface JsonSchema {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly title?: string;
  readonly description?: string;
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly enum?: readonly JsonValue[];
  readonly const?: JsonValue;
  readonly default?: JsonValue;
  readonly examples?: readonly JsonValue[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly patternProperties?: Readonly<Record<string, JsonSchema>>;
  readonly propertyNames?: JsonSchema;
  readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
  readonly items?: JsonSchema;
  readonly prefixItems?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly allOf?: readonly JsonSchema[];
  readonly not?: JsonSchema;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly multipleOf?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly minProperties?: number;
  readonly maxProperties?: number;
}

/** Root schema accepted for an LLM tool's argument object. */
export interface ToolParametersSchema extends JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required: readonly string[];
}

export type BuiltinProviderName = "gemini" | "openai" | "anthropic";
export type ProviderName = BuiltinProviderName | (string & {});
export type BuiltinStrategyName =
  "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto";
export type StrategyName = BuiltinStrategyName | (string & {});

/** Raw/strategy response tool call. IDs are optional until the call enters canonical history. */
export interface ToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args: JsonObject;
  /**
   * Opaque provider-specific metadata that must round-trip with this call.
   *
   * Canonical agent semantics never interpret this data. Providers may use a
   * namespaced entry to preserve protocol fields that are required on later
   * turns (for example Gemini thought signatures).
   */
  readonly providerMetadata?: Readonly<Record<string, JsonObject>>;
}

/** Canonical history always has an identifier so tool results can be paired losslessly. */
export interface CanonicalToolCall extends ToolCall {
  readonly id: string;
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
  readonly type: "tool";
  readonly props: {
    readonly name: string;
    readonly description: string;
    /** Full JSON Schema alternative to <param> shorthand. */
    readonly schema?: ToolParametersSchema;
    readonly children?: JsxAiNode | JsxAiNode[];
  };
}

export interface ParamNode {
  readonly type: "param";
  readonly props: {
    readonly name: string;
    readonly type?: JsonSchemaType;
    readonly required?: boolean;
    readonly enum?: readonly JsonValue[];
    /** Nested/advanced schema for this property. */
    readonly schema?: JsonSchema;
    readonly children?: string;
  };
}

/**
 * JSX message input. The canonical IR validates role-specific fields and pairs
 * assistant tool calls with subsequent tool result messages.
 */
export interface MessageNode {
  readonly type: "message";
  readonly props: {
    readonly role: "user" | "assistant" | "tool";
    readonly toolCalls?: readonly ToolCall[];
    readonly toolCallId?: string;
    readonly toolName?: string;
    readonly isError?: boolean;
    readonly children?: JsxAiNode | JsxAiNode[] | string;
  };
}

export interface SystemNode {
  readonly type: "system";
  readonly props: { readonly children?: JsxAiNode | JsxAiNode[] | string };
}

export interface PromptNode {
  readonly type: "prompt";
  readonly props: {
    readonly model?: string;
    readonly provider?: ProviderName;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly strategy?: StrategyName;
    readonly children?: JsxAiNode | JsxAiNode[];
  };
}

export interface TextNode {
  readonly type: "text";
  readonly value: string;
}

export interface FragmentNode {
  readonly type: "fragment";
  readonly children: JsxAiNode[];
}

// ── Canonical prompt IR ──

export interface ExtractedTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParametersSchema;
}

export interface UserPromptMessage {
  readonly role: "user";
  readonly content: string;
  readonly toolCalls?: never;
  readonly toolCallId?: never;
  readonly toolName?: never;
  readonly isError?: never;
}

export interface AssistantPromptMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls?: readonly CanonicalToolCall[];
  readonly toolCallId?: never;
  readonly toolName?: never;
  readonly isError?: never;
}

export interface ToolResultPromptMessage {
  readonly role: "tool";
  readonly content: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError?: boolean;
  readonly toolCalls?: never;
}

export type ExtractedMessage =
  UserPromptMessage | AssistantPromptMessage | ToolResultPromptMessage;

export interface ExtractedPrompt {
  readonly tools: readonly ExtractedTool[];
  readonly messages: readonly ExtractedMessage[];
  readonly system?: string;
  readonly model?: string;
  readonly providerOverride?: ProviderName;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly strategy?: StrategyName;
}

/** Preferred semantic aliases for new code. */
export type ToolDefinition = ExtractedTool;
export type PromptMessage = ExtractedMessage;
export type PromptIR = ExtractedPrompt;

// ── Provider-agnostic prepared prompt ──

export interface PreparedPrompt {
  readonly system?: string;
  readonly messages: readonly ExtractedMessage[];
  /** Structured tool declarations for native FC strategies (native, hybrid). */
  readonly nativeTools?: readonly ExtractedTool[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

// ── LLM response types ──

export interface ProviderResponse {
  readonly text: string;
  readonly nativeToolCalls: readonly ToolCall[];
  readonly raw: unknown;
  readonly finishReason?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly thinkingTokens?: number;
  };
}

export interface LLMResponse {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly raw: unknown;
  /** Canonical request data is included so logs do not need provider-specific introspection. */
  readonly request?: {
    readonly url: string;
    readonly body: JsonObject;
    readonly prepared: PreparedPrompt;
  };
  readonly finishReason?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly thinkingTokens?: number;
  };
}

// ── Strategy interface ──

export interface RenderStrategy {
  readonly name: string;
  prepare(prompt: ExtractedPrompt): PreparedPrompt;
  /** The canonical prompt is supplied for parsers that need declared tool metadata. */
  parseResponse(
    response: ProviderResponse,
    prompt?: ExtractedPrompt,
  ): { text: string; toolCalls: readonly ToolCall[] };
}
