// ── jsx-ai ──
// JSX interface for structured LLM calls
//
// Usage:
//   import { callLLM } from "jsx-ai"
//
//   const result = await callLLM(
//     <>
//       <system>You are a helpful assistant</system>
//       <tool name="search" description="Search the web">
//         <param name="query" type="string" required>Search query</param>
//       </tool>
//       <message role="user">Find info about TypeScript 6</message>
//     </>,
//     { model: "gemini-2.5-flash" }
//   )

export { callLLM, callText, streamLLM, render, registerStrategy, registerProvider } from "./llm"
export type { CallOptions } from "./llm"
export type {
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
} from "./types"
export { extract } from "./render"
export { native } from "./strategies/native"
export { xml } from "./strategies/xml"
export { natural } from "./strategies/natural"
export { hybrid } from "./strategies/hybrid"
export { nlt } from "./strategies/nlt"
export { md } from "./jsx-runtime"
export { Skill, UseSkillTool, parseSkillFile, resolveSkills } from "./skill"
export type { SkillMeta } from "./skill"
export { GeminiProvider } from "./providers/gemini"
export { OpenAIProvider } from "./providers/openai"
export { AnthropicProvider } from "./providers/anthropic"
export type { Provider } from "./providers/provider"
