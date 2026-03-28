# jsx-ai

[![npm](https://img.shields.io/npm/v/jsx-ai.svg?style=flat-square)](https://www.npmjs.com/package/jsx-ai)
[![bundle](https://img.shields.io/bundlephobia/minzip/jsx-ai?style=flat-square&label=size)](https://bundlephobia.com/package/jsx-ai)
[![test](https://img.shields.io/github/actions/workflow/status/7flash/jsx-ai/test.yml?branch=main&style=flat-square&label=test)](https://github.com/7flash/jsx-ai/actions/workflows/test.yml)
[![registry smoke](https://img.shields.io/badge/release-validation-registry_smoke-blue?style=flat-square)](https://github.com/7flash/jsx-ai/actions/workflows/registry-smoke.yml)

JSX interface for structured LLM calls. Tools, messages, and prompts become composable components.

Badge guide:
- `test` → main CI workflow status for unit + consumer smoke coverage
- `release-validation / registry_smoke` → manual/release registry-install validation workflow

> Release validation: see the [Registry smoke workflow](https://github.com/7flash/jsx-ai/actions/workflows/registry-smoke.yml) and the [release checklist](#release-checklist).

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

### CI map

For contributors/maintainers:
- `.github/workflows/test.yml`
  - **Unit tests** job → `bun run test:unit`
  - **Consumer smoke test** job → `bun run test:smoke`
- `.github/workflows/registry-smoke.yml`
  - **Registry install smoke test** → `bun run test:smoke:registry`
  - used for manual registry validation and release-triggered publish verification

### Which test path to use

- Use `bun test` when you want the full local confidence pass before merging or publishing.
- Use `bun run test:unit` when you are iterating on library internals and want the fast unit/provider/strategy suite.
- Use `bun run test:smoke` when you changed packaging, exports, README install guidance, or consumer-facing entrypoints.
- Use the **Registry smoke** workflow / `bun run test:smoke:registry` when you need to validate an actually published npm package version.
- Use CI/workflow dispatch when you want the same environment GitHub sees, especially for release validation and post-publish checks.

### Release smoke checks

Normal CI covers unit tests plus local-consumer and packed-artifact smoke tests.

For a published npm install check, use `.github/workflows/registry-smoke.yml`:
- Trigger it manually from **Actions → Registry smoke → Run workflow** when you want to verify a registry version on demand.
- Use `jsx-ai@latest` to validate the current latest publish.
- Use an exact version like `jsx-ai@0.1.5` right after a release if you want to confirm that specific npm version is visible.
- Automatic trigger expectation: the workflow runs on **GitHub Release → published** events, not on every tag push by itself.
- In the release path, the workflow resolves the package spec automatically from the release tag (for example `v0.1.5` → `jsx-ai@0.1.5`).
- If you only pushed a tag but did not publish a GitHub Release, run the workflow manually instead.
- If npm propagation is delayed, the workflow already retries automatically before failing.

### Release checklist

Before or during a release:
1. Run local verification:
   - `bun install`
   - `bun test`
   - or the focused scripts: `bun run test:unit` and `bun run test:smoke`
2. Confirm the packed artifact still works via the smoke coverage backed by `bun pm pack`.
3. Publish the package/version.
4. Verify the published registry install:
   - rely on the release-triggered `registry-smoke.yml`, or
   - manually run **Registry smoke** with `jsx-ai@latest` or the exact version you just published.
5. If the registry smoke check fails immediately after publish, wait for npm propagation and rerun the workflow.

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

## License

MIT
