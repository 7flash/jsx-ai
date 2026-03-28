# Provider Starter Snippets

Copy-paste starter examples for the most common provider choices.

## Gemini

Environment:

```sh
GEMINI_API_KEY=your-key
```

Code:

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are helpful.</system>
    <message role="user">Say hello from Gemini.</message>
  </>,
  { model: "gemini-2.5-flash" }
)

console.log(result.text)
```

## OpenAI-compatible

Environment:

```sh
OPENAI_API_KEY=your-key
```

Code:

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are helpful.</system>
    <message role="user">Say hello from OpenAI.</message>
  </>,
  { model: "gpt-4o" }
)

console.log(result.text)
```

## Anthropic

Environment:

```sh
ANTHROPIC_API_KEY=your-key
```

Code:

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are helpful.</system>
    <message role="user">Say hello from Claude.</message>
  </>,
  { model: "claude-3-sonnet-20240229" }
)

console.log(result.text)
```

## Custom OpenAI-compatible route

Use this when the model name does not match built-in detection rules.

Environment:

```sh
OPENAI_API_URL=http://localhost:1234/v1
OPENAI_API_KEY=dummy
```

Code:

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <message role="user">Say hello from my gateway.</message>
  </>,
  {
    provider: "openai",
    model: "custom-openai-route",
  }
)

console.log(result.text)
```

## Text-only call without JSX

```ts
import { callText } from "jsx-ai"

const text = await callText("gpt-4o", [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Say hello." },
])

console.log(text)
```

## Streaming starter

```ts
import { streamLLM } from "jsx-ai"

for await (const chunk of streamLLM("gpt-4o", [
  { role: "user", content: "Count to three." },
])) {
  process.stdout.write(chunk)
}
```

## When to use which snippet

- Use **Gemini** for the default path and most of the project examples.
- Use **OpenAI-compatible** for OpenAI, DeepSeek, Qwen, and compatible gateways.
- Use **Anthropic** when targeting Claude models.
- Use **Custom OpenAI-compatible route** when model naming does not auto-select the provider you need.
- Use **Text-only** when you do not need JSX tools.
- Use **Streaming** when you want incremental output.

## Related guides

- [Quickstart](./quickstart.md)
- [Configuration & compatibility guide](./configuration.md)
- [API reference](./api-reference.md)
- [Examples guide](./examples.md)
