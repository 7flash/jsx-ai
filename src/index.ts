// ── jsx-ai ──
// JSX interface for structured LLM calls
//
// Usage:
//   import { callLLM, render } from "jsx-ai"
//
//   const result = await callLLM(
//     <prompt model="gemini-2.5-flash">
//       <system>You are a helpful assistant</system>
//       <tool name="search" description="Search the web">
//         <param name="query" type="string" required>Search query</param>
//       </tool>
//       <message role="user">Find info about TypeScript 6</message>
//     </prompt>
//   )

export { callLLM, render, registerStrategy } from "./llm"
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
