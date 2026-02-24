# jsx-ai

JSX interface for structured LLM calls. Define tools, messages, and prompts as composable components.

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <prompt model="gemini-2.5-flash">
    <system>You are a coding agent</system>
    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>The command to run</param>
    </tool>
    <message role="user">List all TypeScript files</message>
  </prompt>
)

result.toolCalls  // [{ name: "exec", args: { command: "find . -name '*.ts'" } }]
```

## Why JSX?

**Composability.** Tools become reusable components:

```tsx
const ExecTool = () => (
  <tool name="exec" description="Run a shell command">
    <param name="command" type="string" required>Shell command</param>
  </tool>
)

const ReadFile = () => (
  <tool name="read_file" description="Read file contents">
    <param name="path" type="string" required>File path</param>
  </tool>
)

// Compose tool sets
const CodingTools = () => (
  <>
    <ExecTool />
    <ReadFile />
  </>
)

// Use in any prompt
await callLLM(
  <prompt>
    <CodingTools />
    <message role="user">Read package.json</message>
  </prompt>
)
```

## How It Works

```
JSX Tree → extract() → { tools, messages, system } → strategy.buildRequest() → LLM API
                                                     ↕
                                              strategy.parseResponse() → { text, toolCalls }
```

1. JSX is transpiled using a **custom runtime** (not React) — each `<tag>` becomes a lightweight node
2. `extract()` walks the tree and separates tools, messages, and system prompts
3. A **strategy** converts the extracted data into an API request:
   - **`native`** (default) — tools go into the API's structured `tools` field. 17x fewer output tokens, 2x faster.
   - **`xml`** — tools are described in the system prompt text, model responds with XML. Better multi-tool batching.

## Install

```bash
bun add jsx-ai
```

Add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "jsx-ai"
  }
}
```

## API

### `callLLM(tree, options?)`

```tsx
const result = await callLLM(
  <prompt model="gemini-2.5-flash" temperature={0.3}>
    <system>You are helpful</system>
    <tool name="search" description="Search the web">
      <param name="query" type="string" required>Search query</param>
      <param name="limit" type="number">Max results</param>
    </tool>
    <message role="user">Find TypeScript 6 release notes</message>
  </prompt>,
  { strategy: "native" }  // optional
)

result.text        // Model's text response (if any)
result.toolCalls   // [{ name: "search", args: { query: "..." } }]
result.usage       // { inputTokens, outputTokens }
```

### `render(tree)`

Inspect the extracted prompt without calling the LLM:

```tsx
import { render } from "jsx-ai"

const extracted = render(
  <prompt model="gemini-2.5-flash">
    <tool name="exec" description="Run command">
      <param name="command" type="string" required>Command</param>
    </tool>
    <message role="user">List files</message>
  </prompt>
)

extracted.tools     // [{ name: "exec", parameters: { ... } }]
extracted.messages  // [{ role: "user", content: "List files" }]
extracted.model     // "gemini-2.5-flash"
```

## JSX Elements

| Element | Props | Description |
|---------|-------|-------------|
| `<prompt>` | `model`, `temperature`, `maxTokens`, `strategy` | Root container |
| `<system>` | — | System instruction (text children) |
| `<tool>` | `name`, `description` | Tool/function declaration |
| `<param>` | `name`, `type`, `required`, `enum` | Tool parameter (text children = description) |
| `<message>` | `role` (`user` \| `assistant` \| `tool`) | Conversation message |

## Strategies

### Native (default)
Tools sent via the API's structured `tools` field. The model returns structured JSON function calls.

**Pros:** 17x fewer output tokens, 2x faster, zero parse risk, schema enforcement
**Use when:** You want optimal performance (most cases)

### XML
Tools described in the system prompt. The model responds with XML markup.

**Pros:** Better multi-tool batching per turn
**Use when:** You need the model to call multiple tools simultaneously

```tsx
// Force XML strategy
await callLLM(<prompt strategy="xml">...</prompt>)

// Or via options
await callLLM(<prompt>...</prompt>, { strategy: "xml" })
```

## API Keys

Resolved in order:
1. `options.apiKey` parameter
2. `GEMINI_API_KEY` env var
3. `GOOGLE_API_KEY` env var
4. `.config.toml` file in cwd (`[gemini] api_key = "..."`)

## License

MIT
