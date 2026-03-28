# Extension & Customization Guide

This guide explains how to extend `jsx-ai` without modifying the core package.

## Main extension points

The public package surface exposes three primary customization hooks:

- `registerProvider(name, provider)`
- `registerStrategy(name, strategy)`
- `registerHook(hook)`

These are all exported from `src/index.ts` via `src/llm.ts`.

## Custom providers

Use a custom provider when you need to talk to:
- a different model API
- a self-hosted gateway
- an OpenAI-compatible backend with special routing/auth rules
- an internal proxy that still returns provider-specific payloads

Provider interface (`src/providers/provider.ts`):

```ts
export interface Provider {
  name: string
  buildRequest(prepared: PreparedPrompt, model: string, apiKey: string): {
    url: string
    headers: Record<string, string>
    body: any
  }
  parseResponse(data: any): ProviderResponse
}
```

Responsibilities:
- build API-specific URL/headers/body
- normalize raw API responses into a `ProviderResponse`
- hide auth/header/body differences from the strategy layer

Should not:
- decide prompt/tool encoding policy
- parse JSX directly
- duplicate strategy logic

Example:

```ts
import { registerProvider } from "jsx-ai"
import type { Provider } from "jsx-ai"

const customProvider: Provider = {
  name: "custom",
  buildRequest(prepared, model, apiKey) {
    return {
      url: "https://example.com/v1/chat",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        system: prepared.system,
        messages: prepared.messages,
      },
    }
  },
  parseResponse(data) {
    return {
      text: data.output_text || "",
      nativeToolCalls: [],
      raw: data,
    }
  },
}

registerProvider("custom", customProvider)
```

## Custom strategies

Use a custom strategy when you want to change how prompts/tools are represented to the model.

Strategy interface (`src/types.ts`):

```ts
export interface RenderStrategy {
  name: string
  prepare(prompt: ExtractedPrompt): PreparedPrompt
  parseResponse(response: ProviderResponse): { text: string; toolCalls: ToolCall[] }
}
```

Responsibilities:
- transform extracted prompt data into a provider-agnostic `PreparedPrompt`
- parse normalized provider responses into final `text` + `toolCalls`
- remain provider-agnostic

Should not:
- know HTTP endpoints or auth
- parse raw provider JSON directly
- own provider-specific request body details

Example:

```ts
import { registerStrategy } from "jsx-ai"
import type { RenderStrategy } from "jsx-ai"

const myStrategy: RenderStrategy = {
  name: "my-strategy",
  prepare(prompt) {
    return {
      system: prompt.system,
      messages: prompt.messages
        .filter(m => m.role !== "system" && m.role !== "tool")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    }
  },
  parseResponse(response) {
    return {
      text: response.text,
      toolCalls: response.nativeToolCalls,
    }
  },
}

registerStrategy("my-strategy", myStrategy)
```

## Hooks / telemetry

Use `registerHook()` to observe LLM calls without changing provider/strategy behavior.

Hook shape:
- receives a `PromptEvent`
- can be sync or async
- should not throw intentionally
- is best used for telemetry, logging, debugging, tracing, or analytics

Good hook use cases:
- request/response logging
- prompt explorers
- token/cost dashboards
- timing/quality instrumentation

Example:

```ts
import { registerHook } from "jsx-ai"

registerHook(async (event) => {
  console.log(event.model, event.provider, event.durationMs)
})
```

## How the extension points fit together

The normal `callLLM()` flow is:

1. JSX tree → `extract()`
2. strategy selected
3. provider selected
4. strategy prepares prompt
5. provider builds request
6. fetch executes
7. provider normalizes response
8. strategy parses final text/tool calls
9. hooks observe the finished event

So the extension boundaries are:
- **strategy** = prompt/response semantics
- **provider** = transport/API translation
- **hook** = side effects/telemetry around the call

## Choosing the right extension point

Choose a **provider** if:
- the wire protocol/API differs
- auth headers/base URLs differ
- raw response format differs

Choose a **strategy** if:
- the model should see tools/messages in a different format
- tool-call parsing rules differ
- you want alternate prompting behavior on top of the same provider

Choose a **hook** if:
- you only need observability/logging/analytics
- you do not want to affect model request semantics

## Related guides

- [API reference](./api-reference.md)
- [Examples guide](./examples.md)
- [Architecture guide](./architecture.md)
- [Configuration & compatibility guide](./configuration.md)
- [Contributor CI & test guide](./contributor-ci.md)
- [Maintainer release guide](./maintainer-release.md)
