# Package Architecture

Need the broader guide map? Jump back to the [docs index](./README.md).

## High-level structure

`jsx-ai` is organized around a small pipeline:

1. **JSX tree construction** — custom runtime builds structured prompt nodes
2. **Render/extract** — JSX nodes become an `ExtractedPrompt`
3. **Strategy layer** — provider-agnostic prompt/response formatting
4. **Provider layer** — API-specific request/response translation
5. **LLM entrypoints** — `callLLM`, `callText`, `streamLLM`
6. **Tests/smoke coverage** — unit tests, consumer smoke, registry smoke

## Key files

- `src/index.ts`
  - public export surface for the package
  - re-exports entrypoints, strategies, providers, skills, and types
- `src/jsx-runtime.ts`, `src/jsx-dev-runtime.ts`
  - custom JSX runtime used instead of React
  - creates nodes like `tool`, `message`, `system`, `prompt`, `fragment`
- `src/types.ts`
  - core node, prompt, provider, tool-call, and strategy types
- `src/render.ts`
  - converts JSX node trees into extracted prompt data
- `src/llm.ts`
  - orchestration layer
  - resolves provider + strategy
  - handles API key resolution, hooks, telemetry, text calls, and streaming
- `src/strategies/*`
  - strategy implementations (`native`, `xml`, `natural`, `nlt`, `hybrid`)
  - control how tools/messages are prepared and how responses are parsed
- `src/providers/*`
  - provider adapters for Gemini, OpenAI-compatible APIs, and Anthropic
  - own HTTP body/header details and raw-response normalization
- `src/skill.ts`
  - skill discovery/resolution from markdown files
- `src/index.test.ts`
  - main unit/integration-style test coverage for runtime, extraction, strategies, providers, skills, and streaming
- `src/consumer-smoke.test.ts`
  - temp-project smoke tests for local `file:` and packed tarball installs
- `src/registry-smoke.test.ts`
  - registry-install validation driven by `REGISTRY_SMOKE_SPEC`

## Core call flow

For `callLLM(tree, options)` in `src/llm.ts`:

1. `extract(tree)` converts JSX nodes into structured prompt data.
2. option overrides adjust model/temperature/token settings.
3. strategy is resolved from prompt/options.
4. provider is resolved from model name or explicit override.
5. API key is resolved from options, env vars, or `.config.toml`.
6. strategy prepares a provider-agnostic prompt shape.
7. provider builds `{ url, headers, body }`.
8. fetch executes the request, optionally wrapped by `measure-fn` when available.
9. provider parses raw API output into a normalized provider response.
10. strategy parses that normalized response into final text + tool calls.
11. hooks receive telemetry about the request/response lifecycle.

## Separation of responsibilities

### Strategy layer

Strategies should:
- decide how tools/messages/system prompts are encoded
- parse normalized provider responses into `text` + `toolCalls`
- remain provider-agnostic

Strategies should **not**:
- know HTTP endpoints
- know provider-specific request body shapes
- parse raw provider JSON directly

### Provider layer

Providers should:
- convert prepared prompts into API-specific requests
- normalize raw API responses into a shared provider response shape
- encapsulate provider-specific auth/header/body differences

Providers should **not**:
- decide tool prompting strategy semantics
- know JSX tree details directly

## Provider routing

Provider selection is mostly model-name driven:

- `gpt-*`, `o*`, `chatgpt*` → OpenAI-compatible provider
- `claude*` → Anthropic provider
- `deepseek*`, `qwen*` → OpenAI-compatible provider
- everything else defaults to Gemini

This keeps the public API simple while still allowing explicit provider overrides.

## Telemetry/hooks

`src/llm.ts` also owns the hook system:
- `registerHook()` adds observers for LLM calls
- hooks receive prompt/response/timing/usage/error telemetry
- explorer reporting is auto-registered via `JSX_AI_EXPLORER_URL`
- `measure-fn` is optional and dynamically loaded so missing telemetry tooling does not break consumers

## Test layout

- `bun run test:unit`
  - fast correctness checks for runtime, extraction, strategies, providers, skills, and streaming
- `bun run test:smoke`
  - consumer-install validation from local source and packed artifact
- `bun run test:smoke:registry`
  - published-registry validation for a real package spec
- `bun test`
  - runs the whole local test suite

## When to read which docs

- Use `docs/contributor-ci.md` for test/CI workflow choice
- Use `docs/maintainer-release.md` for publish/release workflow
- Use this file when changing package internals, adding strategies/providers, or tracing request flow

## Related guides

- [API reference](./api-reference.md)
- [Examples guide](./examples.md)
- [Extension & customization guide](./extensibility.md)
- [Configuration & compatibility guide](./configuration.md)
- [Contributor CI & test guide](./contributor-ci.md)
