# Configuration & Compatibility

This guide covers environment variables, API key resolution, `.config.toml`, provider-specific base URL overrides, and related compatibility details.

## API key resolution

`jsx-ai` resolves API keys in this order:

1. explicit `apiKey` option passed to the call
2. provider-specific environment variables
3. `.config.toml` in the current working directory

Example:

```ts
await callLLM(prompt, {
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
})
```

If no key is found, `callLLM()`, `callText()`, or `streamLLM()` throw a provider-specific error with the expected env vars.

## Environment variables by provider

### Gemini

Recognized env vars:

- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`

Used for:
- `gemini-*` models
- default fallback when model name does not match OpenAI/Anthropic patterns

### OpenAI-compatible

Recognized env vars:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `QWEN_API_KEY`
- `DASHSCOPE_API_KEY`

Used for:
- `gpt-*`
- `o*` reasoning models
- `chatgpt*`
- `deepseek*`
- `qwen*`

Notes:
- DeepSeek and Qwen currently use the OpenAI-compatible provider path.
- When provider is forced to `openai`, the same env lookup applies.

### Anthropic

Recognized env vars:

- `ANTHROPIC_API_KEY`

Used for:
- `claude*` models

## Base URL overrides

These are useful for self-hosted gateways, proxies, compatible backends, or alternative endpoints.

### OpenAI-compatible base URLs

#### Standard OpenAI-compatible route

- `OPENAI_API_URL`

Used for standard OpenAI-compatible models such as `gpt-4o`.

Example:

```sh
OPENAI_API_URL=http://localhost:1234/v1
```

#### DeepSeek

- `DEEPSEEK_BASE_URL`

Default:

```txt
https://api.deepseek.com/v1
```

#### Qwen / DashScope

- `DASHSCOPE_BASE_URL`
- fallback: `OPENAI_API_URL`

Default:

```txt
https://coding-intl.dashscope.aliyuncs.com/v1
```

Notes:
- trailing slashes are trimmed automatically
- the provider appends `/chat/completions`

## `.config.toml`

If no env var or explicit `apiKey` is provided, `jsx-ai` tries to read:

```txt
.config.toml
```

from the current working directory.

Expected shape:

```toml
api_key = "your-key-here"
```

Notes:
- this is a simple fallback, not a provider-aware config system
- the same `api_key` value is used regardless of provider
- prefer env vars when working across multiple providers

## Provider detection rules

Provider detection is based on the model name unless you override it.

Current rules:

- `gpt-*`, `o*`, `chatgpt*` → `openai`
- `claude*` → `anthropic`
- `deepseek*`, `qwen*` → `openai`
- everything else → `gemini`

Override example:

```tsx
await callLLM(
  <prompt provider="openai" model="custom-openai-route">
    <message role="user">Hello</message>
  </prompt>
)
```

Or with options:

```ts
await callLLM(tree, {
  provider: "openai",
  model: "custom-openai-route",
})
```

## Provider-specific compatibility notes

### Gemini

- uses `x-goog-api-key`
- merges consecutive same-role messages before request generation
- streaming uses the Gemini SSE endpoint with `:streamGenerateContent?alt=sse`

### OpenAI-compatible

- uses Bearer auth
- supports standard chat completions and streaming chat completions
- `o*` reasoning models use `max_completion_tokens` and fixed `temperature = 1.0`

### Anthropic

- uses `x-api-key`
- sends `anthropic-version: 2023-06-01`
- sends system prompt as a top-level `system` field
- parses `tool_use` content blocks as native tool calls

## Explorer hook

If `JSX_AI_EXPLORER_URL` is set, `jsx-ai` auto-registers a telemetry hook that POSTs prompt events to:

```txt
${JSX_AI_EXPLORER_URL}/api/prompts
```

This is optional. Failures are ignored.

Example:

```sh
JSX_AI_EXPLORER_URL=http://localhost:3001
```

## Recommended setup patterns

### Single-provider local development

```sh
GEMINI_API_KEY=...
```

or:

```sh
OPENAI_API_KEY=...
```

### Multi-provider local development

Set provider-specific env vars explicitly:

```sh
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

This avoids ambiguity from `.config.toml` fallback.

### Local OpenAI-compatible gateway

```sh
OPENAI_API_URL=http://localhost:1234/v1
OPENAI_API_KEY=dummy
```

### DeepSeek via compatible routing

```sh
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=...
```

### Qwen / DashScope

```sh
DASHSCOPE_BASE_URL=https://coding-intl.dashscope.aliyuncs.com/v1
DASHSCOPE_API_KEY=...
```

## Security reminders

- do not commit real API keys
- keep `.config.toml` out of git if it contains secrets
- prefer environment variables in CI and shared dev environments
- use explicit `apiKey` only when you control the calling context

## Related guides

- [Provider starter snippets](./provider-snippets.md)
- [Quickstart](./quickstart.md)
- [API reference](./api-reference.md)
- [Examples guide](./examples.md)
- [Extension & customization guide](./extensibility.md)
