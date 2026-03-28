# API Reference

This is a concise reference for the main public exports from `jsx-ai`.

Need the broader guide map? Jump back to the [docs index](./README.md).

## Core runtime

### `callLLM(tree, options?)`

Call an LLM with a JSX prompt tree.

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a coding agent.</system>
    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>Command to run</param>
    </tool>
    <message role="user">List all TypeScript files.</message>
  </>,
  { model: "gemini-2.5-flash" }
)
```

Returns: `Promise<LLMResponse>`

Use when:
- you want JSX-defined prompts
- you need tools / strategies / skills
- you want provider-normalized usage and parsed tool calls

Important notes:
- provider is auto-detected from `model` unless overridden
- provider can be overridden via `options.provider` or `<prompt provider="...">`
- strategy defaults to `auto`
- request telemetry hooks fire for each call

### `render(tree)`

Render a JSX prompt tree without calling an LLM.

```tsx
import { render } from "jsx-ai"

const extracted = render(
  <>
    <system>You are helpful.</system>
    <message role="user">Hello</message>
  </>
)
```

Returns: `ExtractedPrompt`

Use when:
- inspecting prompt structure
- debugging tools/messages/system extraction
- building examples or tests without network calls

### `callText(model, messages, options?)`

Simple text-in/text-out call without JSX.

```ts
import { callText } from "jsx-ai"

const text = await callText("gpt-4o", [
  { role: "system", content: "You are a planner." },
  { role: "user", content: "Break this task into steps." },
])
```

Returns: `Promise<string>`

Use when:
- you do not need JSX composition
- you do not need tool declarations
- you want the lightest text API

### `streamLLM(model, messages, options?)`

Stream response chunks as an async generator.

```ts
import { streamLLM } from "jsx-ai"

for await (const chunk of streamLLM("gpt-4o", [
  { role: "user", content: "Say hello." },
])) {
  process.stdout.write(chunk)
}
```

Returns: `AsyncGenerator<string>`

Use when:
- you want token/chunk streaming
- you are building interactive CLI or UI output

## Options and responses

### `CallOptions`

Shared options for `callLLM()`.

| Field | Type | Notes |
|---|---|---|
| `apiKey` | `string` | Overrides env-based key resolution |
| `provider` | `string` | Force provider instead of model auto-detect; built-ins are `gemini`, `openai`, and `anthropic`, and custom registered providers are also allowed |
| `strategy` | `"native" \| "xml" \| "natural" \| "nlt" \| "hybrid" \| "auto"` | Override strategy |
| `model` | `string` | Override prompt model |
| `temperature` | `number` | Override sampling temperature |
| `maxTokens` | `number` | Override max output tokens |

### `LLMResponse`

Normalized response returned by `callLLM()`.

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Parsed assistant text |
| `toolCalls` | `ToolCall[]` | Parsed tool calls |
| `raw` | `any` | Raw provider response |
| `request?` | `{ url: string; body: any }` | Built request details for inspection |
| `usage?` | token counts | Normalized usage info |

### `ToolCall`

```ts
{ name: string; args: Record<string, any> }
```

### `<prompt ...>`

Optional config wrapper for prompt-level settings.

Common props:

- `model?: string`
- `provider?: string`
- `temperature?: number`
- `maxTokens?: number`
- `strategy?: "native" | "xml" | "natural" | "nlt" | "hybrid" | "auto"`

Example:

```tsx
<prompt model="custom-openai-route" provider="openai" strategy="xml">
  <message role="user">Hello</message>
</prompt>
```

## Skills API

### `Skill`

Lazy skill component for markdown-backed skills.

```tsx
import { Skill } from "jsx-ai"

<Skill path="skills/bun-expert.md" />
<Skill path="skills/bun-expert.md" resolve />
```

Modes:
- discovery mode: injects lightweight `name + description`
- resolved mode: injects full skill content as system instructions

### `UseSkillTool()`

Adds the built-in `use_skill` tool so the model can request a skill.

```tsx
import { UseSkillTool } from "jsx-ai"

<UseSkillTool />
```

### `parseSkillFile(path)`

Parse a markdown skill file with optional YAML frontmatter.

Returns: `SkillMeta`

### `resolveSkills(skillPaths, requestedNames)`

Resolve matching skills from requested names.

```ts
const resolved = resolveSkills(skillPaths, ["bun-expert"])
```

Returns: `SkillMeta[]`

### `SkillMeta`

```ts
{
  name: string
  description: string
  content: string
  path: string
}
```

## Extension points

### `registerStrategy(name, strategy)`

Register a custom strategy.

```ts
import { registerStrategy } from "jsx-ai"

registerStrategy("my-strategy", {
  name: "my-strategy",
  prepare(prompt) { return { messages: [] } },
  parseResponse(response) { return { text: response.text, toolCalls: [] } },
})
```

Strategy contract: `RenderStrategy`

### `registerProvider(name, provider)`

Register a custom provider.

```ts
import { registerProvider } from "jsx-ai"

registerProvider("custom", provider)
```

Provider contract:
- `buildRequest(prepared, model, apiKey)`
- `parseResponse(data)`

### `registerHook(hook)`

Register a telemetry hook for prompt/response events.

```ts
import { registerHook } from "jsx-ai"

registerHook(event => {
  console.log(event.method, event.model, event.durationMs)
})
```

Hook receives: `PromptEvent`

## Built-in strategies

These are exported so you can inspect or reuse them directly:

- `native`
- `xml`
- `natural`
- `nlt`
- `hybrid`

All implement `RenderStrategy`.

## Built-in providers

These are exported for direct reuse or subclassing:

- `GeminiProvider`
- `OpenAIProvider`
- `AnthropicProvider`

Provider interface:

```ts
interface Provider {
  name: string
  buildRequest(prepared, model, apiKey): { url: string; headers: Record<string, string>; body: any }
  parseResponse(data): ProviderResponse
}
```

## JSX/runtime exports

### `md`

Markdown helper exported from the JSX runtime.

### `extract(tree)`

Lower-level prompt extraction helper used by `render()`.

Returns: `ExtractedPrompt`

## Common types

Useful exported types include:

- `JsxAiNode`
- `ExtractedPrompt`
- `ExtractedTool`
- `ExtractedMessage`
- `PreparedPrompt`
- `ProviderResponse`
- `RenderStrategy`
- `Provider`
- `PromptHook`
- `PromptEvent`
- `LLMResponse`
- `ToolCall`

## Related guides

- [Examples guide](./examples.md)
- [Extension & customization guide](./extensibility.md)
- [Architecture guide](./architecture.md)
