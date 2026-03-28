# Quickstart

Get from install to your first `callLLM()` response in about 5 minutes.

Need the full guide map instead? Start from the [docs index](./README.md).

## 1. Install

```sh
bun add jsx-ai
# or: npm install jsx-ai
```

## 2. Enable the JSX runtime

Add this to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "jsx-ai"
  }
}
```

## 3. Set an API key

Pick the provider/model you want to use and set the matching env var.

### Gemini

```sh
GEMINI_API_KEY=your-key
```

### OpenAI-compatible

```sh
OPENAI_API_KEY=your-key
```

### Anthropic

```sh
ANTHROPIC_API_KEY=your-key
```

If you prefer, you can also pass `apiKey` directly in `callLLM()`.

## 4. Make your first call

Create a file like `hello.tsx`:

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a helpful coding assistant.</system>
    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>The command to run</param>
    </tool>
    <message role="user">List all TypeScript files in this project.</message>
  </>,
  { model: "gemini-2.5-flash" }
)

console.log("text:", result.text)
console.log("toolCalls:", result.toolCalls)
console.log("usage:", result.usage)
```

Run it with Bun:

```sh
bun run hello.tsx
```

## 5. What you get back

`callLLM()` returns a normalized response:

- `result.text` — assistant text
- `result.toolCalls` — parsed tool/function calls
- `result.usage` — normalized token usage when the provider returns it
- `result.request` — built request details for debugging/inspection

## 6. Debug the prompt without calling the model

Use `render()` when you want to inspect what JSX turned into:

```tsx
import { render } from "jsx-ai"

const extracted = render(
  <>
    <system>You are helpful.</system>
    <message role="user">Hello</message>
  </>
)

console.log(JSON.stringify(extracted, null, 2))
```

## 7. Try the fastest next examples

Once the first call works, jump to:

- `bun run examples/coding-agent.tsx` — full tool-based flow with `callLLM()`
- `bun run examples/render-prompt.tsx` — prompt inspection with `render()`
- `bun run examples/call-text.ts` — lightweight text-only calls
- `bun run examples/stream-text.ts` — streaming output with `streamLLM()`
- `bun run examples/skills.tsx` — lazy skill discovery and resolution

## Common first-run issues

### Missing API key

If you see `No API key found for ...`, set the matching env var or pass `apiKey` explicitly.

### Wrong provider chosen

If you use a custom model name, force the provider:

```ts
await callLLM(prompt, {
  provider: "openai",
  model: "custom-openai-route",
})
```

### Want local prompt inspection only

Use `render()` instead of `callLLM()`.

## Where to go next

- [Provider starter snippets](./provider-snippets.md)
- [Examples guide](./examples.md)
- [API reference](./api-reference.md)
- [Configuration & compatibility guide](./configuration.md)
- [Troubleshooting guide](./troubleshooting.md)
- [Extension & customization guide](./extensibility.md)
