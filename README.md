# jsx-ai

[![npm](https://img.shields.io/npm/v/jsx-ai.svg?style=flat-square)](https://www.npmjs.com/package/jsx-ai)
[![bundle](https://img.shields.io/bundlephobia/minzip/jsx-ai?style=flat-square&label=size)](https://bundlephobia.com/package/jsx-ai)
[![test](https://img.shields.io/github/actions/workflow/status/7flash/jsx-ai/test.yml?branch=main&style=flat-square&label=test)](https://github.com/7flash/jsx-ai/actions/workflows/test.yml)
[![registry smoke](https://img.shields.io/badge/release-validation-registry_smoke-blue?style=flat-square)](https://github.com/7flash/jsx-ai/actions/workflows/registry-smoke.yml)

JSX interface for structured LLM calls. Tools, messages, and prompts become composable components.

Badge guide:
- `test` → main CI workflow status for unit + consumer smoke coverage
- `release-validation / registry_smoke` → manual/release registry-install validation workflow

Start here:
- [Quickstart](docs/quickstart.md)
- [What you get](#-what-you-get)
- [Examples guide](docs/examples.md)
- [API reference](docs/api-reference.md)
- [Configuration & compatibility guide](docs/configuration.md)
- [Troubleshooting guide](docs/troubleshooting.md)

Build and extend:
- [Architecture guide](docs/architecture.md)
- [Extension & customization guide](docs/extensibility.md)
- [Docs index](docs/README.md)

Contribute and maintain:
- [Development](#development)
- [Contributor CI & test guide](docs/contributor-ci.md)
- [Maintainer release guide](docs/maintainer-release.md)

> Release validation: see the [Registry smoke workflow](https://github.com/7flash/jsx-ai/actions/workflows/registry-smoke.yml), the [docs index](docs/README.md), and the [maintainer release guide](docs/maintainer-release.md).

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a coding agent</system>
    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>The command to run</param>
    </tool>
    <message role="user">List all TypeScript files</message>
  </>,
  { model: "gemini-2.5-flash" }
)

result.toolCalls  // [{ name: "exec", args: { command: "find . -name '*.ts'" } }]
result.text       // ""
result.usage      // { inputTokens: 42, outputTokens: 15 }
```

## Why JSX?

**Before** — tools as JSON schemas, stringly-typed, not reusable:

```ts
const response = await fetch(url, {
  body: JSON.stringify({
    model: "gemini-2.5-flash",
    systemInstruction: { parts: [{ text: "You are a coding agent" }] },
    tools: [{ functionDeclarations: [{
      name: "exec",
      description: "Run a shell command",
      parameters: { type: "object", properties: {
        command: { type: "string", description: "The command to run" }
      }, required: ["command"] }
    }] }],
    contents: [{ role: "user", parts: [{ text: "List all TypeScript files" }] }],
  })
})
const data = await response.json()
const toolCall = data.candidates[0].content.parts[0].functionCall
```

**After** — same call, composable and provider-agnostic:

```tsx
const ExecTool = () => (
  <tool name="exec" description="Run a shell command">
    <param name="command" type="string" required>The command to run</param>
  </tool>
)

const result = await callLLM(
  <>
    <system>You are a coding agent</system>
    <ExecTool />
    <message role="user">List all TypeScript files</message>
  </>,
  { model: "gemini-2.5-flash" }  // or "gpt-4o" or "claude-3-sonnet-20240229"
)

result.toolCalls  // [{ name: "exec", args: { command: "find . -name '*.ts'" } }]
```

## Installation

```sh
bun add jsx-ai
# or: npm install jsx-ai
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

## Development

Fresh clone / first run:

```sh
bun install
bun test
```

Notes:
- Run `bun install` before `bun test` in a fresh checkout so runtime deps like `measure-fn` are available.
- CI runs the same install + test flow in `.github/workflows/test.yml`.

Contributor/testing workflow notes now live in [docs/contributor-ci.md](docs/contributor-ci.md).

## Runnable examples

Start with the full [examples guide](docs/examples.md), or jump straight to a runnable entrypoint:

- `bun run examples/coding-agent.tsx` — end-to-end JSX agent prompt with tools + `callLLM()`
- `bun run examples/render-prompt.tsx` — inspect extracted prompt structure without a network call
- `bun run examples/customizations.tsx` — custom provider / strategy / hook registration
- `bun run examples/skills.tsx` — skill discovery + resolution flow with markdown skills
- `bun run examples/call-text.ts` — lightweight `callText()` usage without JSX
- `bun run examples/stream-text.ts` — `streamLLM()` token streaming against a local mock SSE server
- `bun run examples/providers.tsx` — Gemini / OpenAI-compatible / Anthropic + provider override flows
- `bun run examples/strategies.tsx` — compare `native`, `xml`, `nlt`, and `hybrid`
- `bun run examples/natural-strategy.tsx` — standalone `natural` strategy protocol and parsing

## ✨ What You Get

- **Multi-provider** → Gemini, OpenAI, Anthropic, DeepSeek — auto-detected from model name
- **5 strategies** → native FC, NLT, XML, natural, hybrid — same prompt, different encodings
- **Composable** → tools and prompts are reusable JSX components
- **Skills** → two-phase skill loading from `.md` files (discovery → resolution)
- **Type-safe** → full TypeScript types, custom JSX runtime (not React)
- **Benchmarked** → multi-turn agentic scenarios scored per strategy

## 🔌 Providers

Auto-detected from model name. Override with `{ provider: "openai" }`.

| Model | Provider | Auth | Env var |
|-------|----------|------|---------|
| `gemini-*` | Gemini | x-goog-api-key | `GEMINI_API_KEY` |
| `gpt-*`, `o4-*` | OpenAI | Bearer | `OPENAI_API_KEY` |
| `claude-*` | Anthropic | x-api-key + version | `ANTHROPIC_API_KEY` |
| `deepseek-*` | OpenAI (compat) | Bearer | `DEEPSEEK_API_KEY` |

```tsx
// Gemini (default)
await callLLM(<>...</>, { model: "gemini-2.5-flash" })

// OpenAI
await callLLM(<>...</>, { model: "gpt-4o" })

// Anthropic
await callLLM(<>...</>, { model: "claude-3-sonnet-20240229" })
```

Provider nuances handled automatically:
- Gemini: merges consecutive same-role messages (API rejects them otherwise)
- OpenAI `o4-*`: uses `max_completion_tokens` + forced `temperature=1.0`
- Anthropic: system prompt as top-level field, `tool_use` blocks, `input_schema`
- DeepSeek: routes to `api.deepseek.com` with OpenAI-compatible format

### Custom providers

```tsx
import { registerProvider } from "jsx-ai"
import type { Provider } from "jsx-ai"

class MyProvider implements Provider {
  name = "custom"
  buildRequest(prepared, model, apiKey) { /* ... */ }
  parseResponse(data) { /* ... */ }
}

registerProvider("custom", new MyProvider())
await callLLM(<>...</>, { provider: "custom", model: "my-model" })
```

## 🎯 Strategies

Same JSX prompt, different tool encodings. Each strategy controls how tools appear to the model and how responses are parsed.

| Strategy | Tools sent as | Response parsed from | Best for |
|----------|---------------|---------------------|----------|
| `native` | API `tools` field | Structured FC | Single tool calls, lowest tokens |
| `nlt` | Text descriptions + native FC | Structured FC | Multi-turn agentic loops |
| `xml` | Text with XML schema | XML in text | Multi-tool batching |
| `natural` | Text descriptions | Action blocks in text | Complex reasoning + tools |
| `hybrid` | API `tools` + text schema | Either | Balanced |

```tsx
// Strategy via options
await callLLM(<>...</>, { strategy: "nlt" })

// Or register a custom one
import { registerStrategy } from "jsx-ai"
registerStrategy("my-strategy", { prepare, parseResponse })
```

### Benchmark results (gemini-2.5-flash, kv-store scenario)

3-turn agentic loop: Plan → Execute → Adapt

| Strategy | Turn 1 (Plan) | Turn 2 (Execute) | Turn 3 (Adapt) | Total |
|----------|:---:|:---:|:---:|:---:|
| **nlt** | 100% | 73% | 84% | **86%** |
| **natural** | 100% | 67% | 69% | **79%** |
| **native** | 46% | 5% | 33% | **28%** |

> Native FC underperforms in agentic loops because it batches homogeneous tool calls — calling 5× `use_skill` but skipping `set_objectives` in the same turn.

## 📦 JSX Elements

| Element | Props | Description |
|---------|-------|-------------|
| `<system>` | — | System instruction (text children) |
| `<tool>` | `name`, `description` | Tool/function declaration |
| `<param>` | `name`, `type`, `required`, `enum` | Tool parameter (children = description) |
| `<message>` | `role` (`user` \| `assistant`) | Conversation message |
| `<prompt>` | `model`, `temperature`, `maxTokens`, `strategy` | Optional config wrapper |

## 🧠 Skills

Two-phase skill loading from `.md` files with YAML frontmatter:

```md
---
name: bun-expert
description: Bun runtime expertise — Bun.serve(), bun:sqlite, bun:test
---
## Bun Runtime
- HTTP: Bun.serve() with export default { port, fetch } pattern
- Database: import { Database } from "bun:sqlite"
- Testing: import { describe, it, expect } from "bun:test"
```

**Phase 1 — Discovery:** skills appear as a lightweight catalog

```tsx
import { Skill, UseSkillTool } from "jsx-ai"

await callLLM(
  <>
    <Skill path="skills/bun-expert.md" />
    <Skill path="skills/security.md" />
    <UseSkillTool />
    <message role="user">Build a KV store API</message>
  </>
)
// Model sees: "Available skill: bun-expert — Bun runtime expertise"
// Model calls: use_skill({ skill_name: "bun-expert" })
```

**Phase 2 — Resolution:** requested skills expand to full content

```tsx
import { Skill, resolveSkills } from "jsx-ai"

const resolved = resolveSkills(skillPaths, ["bun-expert"])

await callLLM(
  <>
    <Skill path="skills/bun-expert.md" resolve />
    <Skill path="skills/security.md" />
    <message role="user">Now implement it</message>
  </>
)
// Model sees full bun-expert methodology + just the catalog entry for security
```

## 🔍 `render(tree)`

Inspect the extracted prompt without calling the LLM:

```tsx
import { render } from "jsx-ai"

const extracted = render(
  <>
    <system>You are helpful</system>
    <tool name="exec" description="Run command">
      <param name="command" type="string" required>Command</param>
    </tool>
    <message role="user">List files</message>
  </>
)

extracted.tools     // [{ name: "exec", parameters: { ... } }]
extracted.messages  // [{ role: "user", content: "List files" }]
extracted.system    // "You are helpful"
```

## ⚙️ CallOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | `"gemini-2.5-flash"` | Model name (also determines provider) |
| `provider` | `"gemini" \| "openai" \| "anthropic"` | auto-detected | Force a specific provider |
| `strategy` | `"native" \| "nlt" \| "xml" \| "natural" \| "hybrid"` | `"auto"` | Tool encoding strategy |
| `apiKey` | `string` | from env | Override API key |
| `temperature` | `number` | `0.1` | Sampling temperature |
| `maxTokens` | `number` | `4000` | Max output tokens |

## 💬 `callText(model, messages, options?)`

Simple text-in/text-out LLM call — no JSX needed. Uses the same provider routing and auth:

```ts
import { callText } from "jsx-ai"

const text = await callText("gemini-2.5-flash", [
  { role: "system", content: "You are a planner. Break tasks into steps." },
  { role: "user", content: "Build a REST API with authentication" },
])

console.log(text)  // "1. Set up project with Bun.serve()..."
```

## 🔄 `streamLLM(model, messages, options?)`

Stream LLM responses token-by-token via SSE. Same provider routing as `callText`:

```ts
import { streamLLM } from "jsx-ai"

for await (const chunk of streamLLM("gemini-2.5-flash", [
  { role: "system", content: "You are a storyteller" },
  { role: "user", content: "Tell me a short story" },
])) {
  process.stdout.write(chunk)
}
```

Options for both `callText` and `streamLLM`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `temperature` | `number` | `0.3` | Sampling temperature |
| `maxTokens` | `number` | `8000` | Max output tokens |
| `apiKey` | `string` | from env | Override API key |

> Maintainers: release/publish notes live in [docs/maintainer-release.md](docs/maintainer-release.md).

## License

MIT
