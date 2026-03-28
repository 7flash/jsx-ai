# jsx-ai Docs

## Start here

If you're new to the library, use this order:

1. [Quickstart](./quickstart.md) — install, configure, and make your first `callLLM()` call.
2. [Provider starter snippets](./provider-snippets.md) — minimal copy-paste Gemini, OpenAI-compatible, Anthropic, text-only, and streaming examples.
3. [Examples guide](./examples.md) — runnable example entrypoints and what each one demonstrates.
4. [API reference](./api-reference.md) — concise reference for the main exports, options, skills API, hooks, strategies, providers, and common types.
5. [Configuration & compatibility guide](./configuration.md) — env vars, `.config.toml`, provider detection, explorer hook, and base URL overrides.
6. [Troubleshooting guide](./troubleshooting.md) — common setup, provider, streaming, skills, and CI/smoke test failures with quick fixes.

## Build and extend

- [Architecture guide](./architecture.md) — package structure, call flow, strategy/provider separation, and where core responsibilities live.
- [Extension & customization guide](./extensibility.md) — custom providers, strategies, hooks, and how they fit into the request pipeline.

## Contribute and maintain

- [Contributor CI & test guide](./contributor-ci.md) — CI workflow ownership, when to use each test path, and benchmark-vs-test guidance.
- [Maintainer release guide](./maintainer-release.md) — release validation, registry smoke workflow usage, version alignment, and post-release checks.

## Example quick map

- `examples/coding-agent.tsx` — composable tools + `callLLM()`
- `examples/render-prompt.tsx` — prompt inspection via `render()`
- `examples/customizations.tsx` — custom providers, strategies, hooks
- `examples/skills.tsx` — skill discovery + resolution
- `examples/call-text.ts` — `callText()`
- `examples/stream-text.ts` — `streamLLM()`
- `examples/providers.tsx` — provider-specific flows + override
- `examples/strategies.tsx` — `native`, `xml`, `nlt`, `hybrid`
- `examples/natural-strategy.tsx` — standalone `natural` strategy
