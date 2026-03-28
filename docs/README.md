# jsx-ai Docs

## Start here

- [Examples guide](./examples.md) — runnable example entrypoints and what each one demonstrates.
- [API reference](./api-reference.md) — concise reference for the main exports, options, skills API, hooks, strategies, providers, and common types.
- [Architecture guide](./architecture.md) — package structure, call flow, strategy/provider separation, and where core responsibilities live.
- [Extension & customization guide](./extensibility.md) — custom providers, strategies, hooks, and how they fit into the request pipeline.
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
