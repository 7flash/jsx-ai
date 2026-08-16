export { runAgent } from "./agent";
export type {
  AgentRunOptions,
  AgentRunResult,
  AgentStopReason,
  AgentUsage,
  AgentContext,
  AgentStep,
  AgentEvent,
  AgentToolResult,
  AgentToolExecutorResult,
} from "./agent";

// jsx-ai — composable JSX frontend for a provider-agnostic LLM prompt IR.
export {
  callLLM,
  callText,
  streamLLM,
  render,
  registerStrategy,
  registerProvider,
  listStrategies,
  listProviders,
  registerHook,
} from "./llm";
export type {
  CallOptions,
  RequestOptions,
  TextMessage,
  TextCallOptions,
  PromptHook,
  PromptEvent,
} from "./llm";

export {
  JsxAiError,
  HttpError,
  ResponseParseError,
  RequestTimeoutError,
  TransportError,
  isJsxAiError,
} from "./errors";
export type { JsxAiErrorCode } from "./errors";

export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  BuiltinProviderName,
  ProviderName,
  BuiltinStrategyName,
  StrategyName,
  JsxAiNode,
  ToolNode,
  ParamNode,
  MessageNode,
  SystemNode,
  PromptNode,
  TextNode,
  FragmentNode,
  ExtractedTool,
  ExtractedMessage,
  ExtractedPrompt,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
  LLMResponse,
  RenderStrategy,
} from "./types";
export { extract } from "./render";
export { native } from "./strategies/native";
export { xml } from "./strategies/xml";
export { natural } from "./strategies/natural";
export { hybrid } from "./strategies/hybrid";
export { nlt } from "./strategies/nlt";
export { md } from "./jsx-runtime";
export { Skill, UseSkillTool, parseSkillFile, resolveSkills } from "./skill";
export type { SkillMeta } from "./skill";
export { GeminiProvider } from "./providers/gemini";
export { OpenAIProvider } from "./providers/openai";
export { AnthropicProvider } from "./providers/anthropic";
export type { Provider, ProviderRequest } from "./providers/provider";
