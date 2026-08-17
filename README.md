# jsx-ai

**Composable JSX for structured LLM calls, tools, and agent loops.**

`jsx-ai` turns a JSX component tree into a validated provider-neutral prompt IR, lowers it through a strategy, sends it through a provider adapter, and normalizes the response back into text, tool calls, usage, and canonical multi-turn history.

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a coding agent.</system>

    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>
        Shell command to execute
      </param>
    </tool>

    <message role="user">List all TypeScript files.</message>
  </>,
)

console.log(result.toolCalls)
console.log(result.usage)
```

No React runtime is involved. JSX is only the typed composition syntax.

---

## Why jsx-ai?

Provider APIs expose the same broad concepts—system instructions, messages, tools, tool results, generation settings—but encode them differently.

`jsx-ai` separates those concerns:

```text
JSX components
      │
      ▼
validated PromptIR
      │
      ├── runtime: api
      │     ├── strategy lowering
      │     ├── Gemini adapter
      │     ├── OpenAI adapter
      │     ├── Anthropic adapter
      │     └── custom providers
      │
      └── runtime: codex
            └── local Codex SDK/CLI
                 (structured response bridge)
      │
      ▼
normalized LLMResponse
```

The practical result is that your prompt composition and agent logic do not need provider-specific request JSON.

---

## Installation

```bash
bun add jsx-ai
```

or:

```bash
npm install jsx-ai
```

Configure JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "jsx-ai"
  }
}
```

`jsx-ai` exports its own `jsx-runtime` and `jsx-dev-runtime`.

---

# Runtime Selection

Runtime selection is a **library concern**, not an example concern. Every JSX example can run unchanged through either backend.

```bash
# Provider HTTP APIs (default)
JSX_AI_RUNTIME=api bun run example:game

# Local Codex SDK/CLI using saved Codex login
JSX_AI_RUNTIME=codex bun run example:game
```

PowerShell:

```powershell
$env:JSX_AI_RUNTIME = "codex"
bun run example:game
```

Environment defaults:

| Variable | Meaning | Default |
|---|---|---|
| `JSX_AI_RUNTIME` | `api` or `codex` | `api` |
| `JSX_AI_MODEL` | optional global model override | API: `gemini-2.5-flash`; Codex: use `~/.codex/config.toml` |

Precedence for `callLLM()` is:

```text
callOptions.runtime → JSX_AI_RUNTIME → api
callOptions.model   → JSX_AI_MODEL   → <prompt model> → runtime default
```

With `JSX_AI_RUNTIME=codex` and no `JSX_AI_MODEL`, jsx-ai deliberately omits the model from the SDK thread options so your normal Codex configuration chooses it. The examples do not duplicate Codex auth, model, sandbox, approval, or reasoning configuration.

Explicit call options remain useful when an individual call intentionally overrides the process-wide default.

---

# Quick Start

## A text + tool call

```tsx
import { callLLM } from "jsx-ai"

const SearchTool = () => (
  <tool name="search" description="Search the project">
    <param name="query" type="string" required>
      Search query
    </param>
  </tool>
)

const result = await callLLM(
  <>
    <system>
      You are a software engineer working inside an existing project.
    </system>

    <SearchTool />

    <message role="user">
      Find where authentication is implemented.
    </message>
  </>,
)

console.log(result.text)
console.log(result.toolCalls)
console.log(result.usage)
```

`LLMResponse` contains:

```ts
{
  text: string
  toolCalls: ToolCall[]
  finishReason?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    thinkingTokens?: number
  }
  raw: unknown
  request?: {
    url: string
    body: JsonObject
    prepared: PreparedPrompt
  }
}
```

---

# Agent Runtime

For iterative agents, prefer `runAgent()` over hand-writing the model → tool → result loop.

`runAgent()` owns the invariant mechanics:

- canonical assistant/tool-result history
- stable tool-call IDs
- provider metadata round-tripping
- model-step and tool-call budgets
- input/output token budgets
- overall duration budget
- cancellation
- no-tool recovery
- completion predicates
- lifecycle events

Your application still owns:

- the JSX prompt
- tool definitions
- tool execution
- project/application state
- completion semantics

## Minimal agent

```tsx
import { runAgent } from "jsx-ai"
import type { CanonicalToolCall } from "jsx-ai"

const result = await runAgent({
  history: [
    { role: "user", content: "Create hello.txt containing hello world" },
  ],

  buildPrompt: history => (
    <>
      <system>You are a filesystem agent.</system>

      <tool name="write_file" description="Write a UTF-8 file">
        <param name="path" type="string" required>File path</param>
        <param name="content" type="string" required>Complete content</param>
      </tool>

      <tool name="done" description="Finish the task">
        <param name="summary" type="string" required>Completion summary</param>
      </tool>

      {history.map(message => (
        <message
          role={message.role}
          toolCalls={message.toolCalls}
          toolCallId={message.toolCallId}
          toolName={message.toolName}
          isError={message.isError}
        >
          {message.content}
        </message>
      ))}
    </>
  ),

  executeTool: async (call: CanonicalToolCall) => {
    if (call.name === "write_file") {
      // perform the real side effect here
      return `Wrote ${String(call.args.path)}`
    }

    if (call.name === "done") {
      return "Done"
    }

    return { content: `Unknown tool: ${call.name}`, isError: true }
  },

  isComplete: response =>
    response.toolCalls.some(call => call.name === "done"),

  maxSteps: 12,
  maxToolCalls: 64,
  maxDurationMs: 5 * 60_000,
})

console.log(result.reason)
console.log(result.usage)
```

The returned `AgentRunResult` includes the final canonical history, each model step, cumulative usage, tool-call count, elapsed time, stop reason, and caller-owned state.

---

# Observability: Core Is Silent, Examples Are Verbose

The **core library does not write routine logs to stdout/stderr**.

That is intentional. A library should not decide how a CLI, server, test runner, desktop app, or telemetry system presents model activity.

Use one of these instead:

1. inspect `LLMResponse` / `AgentRunResult` directly;
2. use `runAgent({ onEvent })` for agent lifecycle events;
3. use `registerHook()` for model-call telemetry;
4. build structured presentation in your application or example.

The repository examples use [`measure-fn`](https://github.com/7flash/measure-fn) as a **development-only dependency** for hierarchical timing/tracing. It is not a runtime dependency of `jsx-ai` itself.

## What the game-builder example prints

Run:

```bash
bun run example:game
```

or switch runtime/model globally without editing the example:

```bash
JSX_AI_RUNTIME=codex bun run examples/game-builder-agent.tsx ./game-output
JSX_AI_RUNTIME=api JSX_AI_MODEL=gemini-3-flash-preview bun run examples/game-builder-agent.tsx ./game-output
```

The example prints its application configuration first; model-step result records show the runtime/model that jsx-ai actually used:

```text
jsx-ai game builder
runtime/model: resolved by jsx-ai (JSX_AI_RUNTIME / JSX_AI_MODEL)
strategy: hybrid (API runtime; Codex uses its structured bridge)
output: .../game-output
budgets: 8 model steps / 48 tool calls / 8 min per phase
```

Then `measure-fn` emits a hierarchical trace. Exact timings/token counts depend on the run, but the shape is intentionally detailed:

```text
[a] ... Game-builder run (model=..., strategy=hybrid, phases=3)
[a-a] ... Phase 1 — Build Canvas game
[a-a-a] ... Model step 1
[a-a-a]     Model step 1 4.2s → {
  "finishReason":"STOP",
  "tools":[
    {"tool":"write_file","path":"index.html","contentChars":...},
    {"tool":"write_file","path":"game.js","contentChars":...}
  ],
  "tokens":{"inputTokens":...,"outputTokens":...,"thinkingTokens":...,"totalTokens":...}
}
[a-a-b] ... Tool — write_file (path=index.html, contentChars=...)
[a-a-c] ... Tool — write_file (path=game.js, contentChars=...)
...
```

At the end it prints a per-phase table:

```text
Run summary
┌───────┬──────────────────────────────┬───────┬───────┬─────────────┬──────────────┬────────────────┬───────────┐
│ phase │ name                         │ steps │ tools │ inputTokens │ outputTokens │ thinkingTokens │ elapsedMs │
└───────┴──────────────────────────────┴───────┴───────┴─────────────┴──────────────┴────────────────┴───────────┘
```

and totals:

```text
Total tokens: <input> input + <output> output + <thinking> thinking = <total>
Total elapsed: <seconds>s
Output directory: .../game-output
```

followed by a generated-file manifest with byte sizes.

This is the intended division of responsibility: **core returns structured facts; examples decide how those facts should look in a terminal.**

---

# JSX Elements

## `<system>`

```tsx
<system>
  You are a senior TypeScript engineer.
</system>
```

Multiple `<system>` blocks are combined into the canonical system instruction.

## `<message>`

```tsx
<message role="user">
  Refactor the database layer.
</message>
```

Canonical history supports:

- user messages
- assistant text
- assistant tool calls
- tool results paired by tool-call ID/name
- tool error results

When reconstructing history manually:

```tsx
<message
  role={message.role}
  toolCalls={message.toolCalls}
  toolCallId={message.toolCallId}
  toolName={message.toolName}
  isError={message.isError}
>
  {message.content}
</message>
```

For agents, `runAgent()` handles the canonical history mechanics for you.

## `<tool>`

Simple shorthand:

```tsx
<tool name="exec" description="Run a shell command">
  <param name="command" type="string" required>
    Command to execute
  </param>
</tool>
```

Advanced JSON Schema:

```tsx
<tool
  name="search"
  description="Search records"
  schema={{
    type: "object",
    properties: {
      filters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["status"],
      },
    },
    required: ["filters"],
  }}
/>
```

Schemas are normalized and validated before a built-in provider receives them.

## `<param>`

```tsx
<param
  name="format"
  type="string"
  enum={["json", "text"]}
  required
>
  Output format
</param>
```

A parameter may also use a nested `schema` object for constraints that do not fit the shorthand props.

## `<prompt>`

```tsx
<prompt
  model="gemini-2.5-flash"
  strategy="hybrid"
  temperature={0.2}
  maxTokens={8000}
>
  ...
</prompt>
```

The same settings can be overridden in `callLLM()` options.

---

# Canonical Prompt IR

JSX is a frontend. The invariant object is the validated `PromptIR` / `ExtractedPrompt`.

```ts
interface ExtractedPrompt {
  tools: readonly ExtractedTool[]
  messages: readonly ExtractedMessage[]
  system?: string
  model?: string
  providerOverride?: ProviderName
  temperature?: number
  maxTokens?: number
  strategy?: StrategyName
}
```

Useful exports:

```ts
import {
  extract,
  render,
  normalizePromptIR,
  normalizePreparedPrompt,
  normalizeJsonSchema,
} from "jsx-ai"
```

`render(tree)` is a convenient way to inspect the validated prompt without calling a model.

```tsx
const prompt = render(
  <>
    <system>You are helpful.</system>
    <message role="user">Hello</message>
  </>,
)

console.log(prompt.messages)
```

---

# Multi-Turn Tool History

Tool history is not flattened into prose.

The canonical IR preserves assistant tool calls and corresponding tool-result messages, and each provider serializes that history using its native protocol.

That includes opaque provider metadata which may be required for a later turn. Application-level agent code should carry canonical messages forward rather than reconstructing provider-specific fields itself.

`runAgent()` is the easiest way to get this right.

---

# Providers

Provider routing is inferred from the model name unless explicitly overridden.

| Model prefix | Adapter | Common environment variable |
|---|---|---|
| `gemini-*` | Gemini | `GEMINI_API_KEY` |
| `gpt-*`, `o*`, `chatgpt*` | OpenAI | `OPENAI_API_KEY` |
| `claude-*` | Anthropic | `ANTHROPIC_API_KEY` |
| `deepseek*`, `qwen*` | OpenAI-compatible | provider-specific key |

Explicit override:

```tsx
await callLLM(tree, {
  provider: "anthropic",
  model: "claude-...",
})
```

List registered backends:

```ts
import { listProviders } from "jsx-ai"

console.log(listProviders())
```

## OpenAI API runtime vs. ChatGPT-authenticated Codex runtime

`jsx-ai` has two execution runtimes. They share the same JSX/`PromptIR`/`LLMResponse`
contract, but they are intentionally different transports and authentication paths.

| Runtime | Execution path | Authentication | Usage/billing surface |
|---|---|---|---|
| `api` (default) | provider HTTP API | provider API key | provider API account |
| `codex` | local `@openai/codex-sdk` / Codex CLI | saved Codex login by default | ChatGPT/Codex plan limits and credits |

The Codex SDK is optional because most `jsx-ai` applications do not need it:

```bash
bun add @openai/codex-sdk
bunx @openai/codex login
```

Then the **same application code** can run through Codex by selecting the runtime outside the program:

```bash
JSX_AI_RUNTIME=codex bun run your-app.tsx
```

```tsx
// No Codex branch is required in application code.
const result = await callLLM(tree)
```

If you need a process-wide model override, set `JSX_AI_MODEL`. Otherwise Codex uses the model from `~/.codex/config.toml`. Per-call `runtime`, `model`, and `codex` options still exist for deliberate exceptions, but repository examples do not need them.

`auth: "chatgpt"` is the default. In that mode `jsx-ai` gives the Codex child process a
controlled environment with `OPENAI_API_KEY` and `CODEX_API_KEY` removed, so an unrelated
API key in the parent shell does not silently change the intended auth path. Passing
`apiKey` together with `runtime: "codex"` is rejected. Use `runtime: "api"` when explicit
OpenAI API-key billing is what you want.

`codex.auth: "inherit"` is an advanced escape hatch that lets the Codex SDK inherit the
parent process environment. Use it only when that behavior is intentional.

The Codex adapter uses the official SDK's structured-output facility to bridge canonical
`jsx-ai` tools into normalized `{ text, toolCalls }`. `runAgent()` therefore continues to
own the normal host tool loop; the Codex runtime defaults to a read-only sandbox, no
network access, and no approval prompts.

A few options differ by runtime:

- `strategy` controls provider lowering for `runtime: "api"`; Codex uses its own structured bridge;
- `retries` is an HTTP-provider option and is not applied to Codex SDK turns;
- `temperature` and `maxTokens` are not currently Codex SDK thread controls;
- use `codex.modelReasoningEffort` for Codex reasoning effort;
- `streamLLM()` currently supports the API runtime only; use `callLLM()`/`callText()` for Codex;
- Codex token usage is normalized into `inputTokens`, `outputTokens`, and `thinkingTokens` when reported by the SDK.

ChatGPT/Codex plan usage is not unlimited or equivalent to raw API credits; its included
limits and optional credit behavior are governed by the active ChatGPT plan.

## Custom provider

```ts
import { registerProvider } from "jsx-ai"
import type { Provider } from "jsx-ai"

const provider: Provider = {
  name: "custom",
  buildRequest(prepared, model, apiKey) {
    // lower PreparedPrompt to your wire request
    throw new Error("implement me")
  },
  parseResponse(data) {
    // normalize unknown provider response
    throw new Error("implement me")
  },
}

const dispose = registerProvider("custom", provider)

// ... use provider ...

dispose()
```

Registration returns a disposer so tests/plugins can restore the previous registry state.

---

# Strategies

Strategies decide how canonical tools/messages are presented to and parsed from the model.

Built-ins:

- `native` — provider-native function/tool calling;
- `hybrid` — native tool calling plus behavioral guidance;
- `natural` — natural-language action blocks;
- `nlt` — explicit natural-language tool selection protocol;
- `xml` — XML prompt/response tool protocol;
- `auto` — resolves to the library's automatic/default strategy policy.

```tsx
await callLLM(tree, {
  model: "gemini-2.5-flash",
  strategy: "hybrid",
})
```

Custom strategies:

```ts
import { registerStrategy } from "jsx-ai"

const dispose = registerStrategy("my-strategy", {
  name: "my-strategy",
  prepare(prompt) {
    return {
      system: prompt.system,
      messages: prompt.messages,
    }
  },
  parseResponse(response) {
    return {
      text: response.text,
      toolCalls: response.nativeToolCalls,
    }
  },
})

// later
dispose()
```

Prepared prompts are normalized again before provider execution, so a malformed custom strategy cannot silently bypass the canonical boundary.

---

# Skills

Skills support two-phase context loading from Markdown files with YAML frontmatter.

```md
---
name: bun-expert
description: Bun runtime expertise
---

## Bun runtime

- use Bun.serve()
- use bun:sqlite
- use bun:test
```

Discovery:

```tsx
<>
  <Skill path="skills/bun-expert.md" />
  <Skill path="skills/security.md" />
  <UseSkillTool />
</>
```

Resolution:

```tsx
<Skill path="skills/bun-expert.md" resolve />
```

`resolveSkills()` performs normalized skill-name resolution, while parsed skill files are cached to avoid repeated synchronous reads during prompt rendering.

Run the measured example:

```bash
bun run example:skills
```

---

# `callLLM()`

Use `callLLM()` for structured prompts/tools.

```tsx
const result = await callLLM(tree, {
  model: "gemini-2.5-flash",
  strategy: "hybrid",
  temperature: 0.2,
  maxTokens: 8000,
  retries: 3,
  timeoutMs: 90_000,
})
```

Important request options include:

| Field | Purpose |
|---|---|
| `model` | model name and provider-routing hint |
| `provider` | explicit provider override |
| `strategy` | tool encoding/parsing strategy |
| `apiKey` | explicit API key override |
| `temperature` | sampling temperature |
| `maxTokens` | output-token limit |
| `retries` | transient request retries |
| `timeoutMs` | request timeout |
| `signal` | caller cancellation |

The current fallback model when none is supplied is `gemini-2.5-flash`. For reproducible applications, set the model explicitly.

---

# `callText()`

For simple text-only generation:

```ts
import { callText } from "jsx-ai"

const text = await callText(
  "gemini-2.5-flash",
  [
    { role: "system", content: "You are a planner." },
    { role: "user", content: "Break this migration into steps." },
  ],
  {
    temperature: 0.3,
    maxTokens: 4000,
    timeoutMs: 60_000,
  },
)
```

---

# `streamLLM()`

```ts
import { streamLLM } from "jsx-ai"

for await (const chunk of streamLLM(
  "gemini-2.5-flash",
  [
    { role: "system", content: "You are a storyteller." },
    { role: "user", content: "Tell me a short story." },
  ],
)) {
  process.stdout.write(chunk)
}
```

Streaming uses the same provider routing/authentication infrastructure and supports caller cancellation.

---

# Telemetry Hooks

`registerHook()` exposes normalized model-call telemetry without printing it.

```ts
import { registerHook } from "jsx-ai"

const dispose = registerHook(event => {
  telemetry.record({
    model: event.model,
    provider: event.provider,
    strategy: event.strategy,
    usage: event.usage,
    durationMs: event.durationMs,
    tools: event.tools,
  })
})

// ... run calls ...

dispose()
```

Hook failures are isolated from model execution.

---

# Errors

Transport/provider failures use exported structured error classes:

```ts
import {
  JsxAiError,
  HttpError,
  RequestTimeoutError,
  ResponseParseError,
  TransportError,
  isJsxAiError,
} from "jsx-ai"
```

Consumers can branch on stable error identity/codes rather than parsing console text.

---

# Markdown with `md`

```tsx
import { md } from "jsx-ai"

<system>{md`
  You are an autonomous browser-game engineer.

  Requirements:
  - inspect existing files before changing them
  - keep the codebase small
  - do not claim completion until the game is playable
`}</system>
```

`md` removes the common indentation from multiline template strings.

---

# Examples

All repository examples are intentionally observable and use `measure-fn` for timing/tracing.

```bash
bun run example:coding
bun run example:skills
bun run example:game
bun run example:runtime
```

The dependency belongs to `devDependencies`; importing `jsx-ai` does not import or initialize `measure-fn`.

## Game builder

`examples/game-builder-agent.tsx` demonstrates the complete agent stack:

1. build a Canvas game;
2. inspect and improve it;
3. migrate the presentation to Three.js;
4. preserve canonical multi-turn tool history across all phases;
5. report measured model/tool durations, token usage, phase totals, and generated-file sizes.

The example writes only inside its configured output directory.

Every example uses the same library-level runtime switch:

```bash
bunx @openai/codex login
JSX_AI_RUNTIME=codex bun run example:game ./game-output
JSX_AI_RUNTIME=codex bun run example:coding
JSX_AI_RUNTIME=codex bun run example:skills
JSX_AI_RUNTIME=codex bun run example:runtime ./runtime-output "Create a tiny browser game in index.html"
```

On PowerShell, set it once for the shell session:

```powershell
$env:JSX_AI_RUNTIME = "codex"
bun run example:game ./game-output
bun run example:coding
bun run example:skills
```

Switch back just as globally:

```powershell
$env:JSX_AI_RUNTIME = "api"
$env:JSX_AI_MODEL = "gemini-2.5-flash"
```

## Runtime-neutral host-tool agent

`examples/runtime-agent.tsx` is the smaller reference example for the runtime boundary. It contains no API/Codex branch: `runAgent()` and the application own `list_files`, `read_file`, `write_file`, and `done`, while jsx-ai chooses the execution backend.

The example uses `measure-fn` to show every model step and host tool execution plus normalized input/output/reasoning tokens. Core `src/` code remains silent.

---

# Benchmark

Run:

```bash
bun run bench
```

The benchmark is designed around completed task outcomes under equal budgets rather than a fixed number of conversational turns. It records strategy/model configuration, usage, latency, tool activity, stopping conditions, infrastructure errors, and final evaluator results.

The README intentionally does **not** publish a stale hard-coded strategy leaderboard. Benchmark numbers are meaningful only together with the model, scenario, iteration count, budgets, and run date that produced them.

---

# Development

```bash
bun install
bun run typecheck
bun test
bun run check
bun run bench
```

Useful scripts:

| Script | Command |
|---|---|
| typecheck | `bun run typecheck` |
| tests | `bun test` |
| full check | `bun run check` |
| benchmark | `bun run bench` |
| coding example | `bun run example:coding` |
| skills example | `bun run example:skills` |
| game builder | `bun run example:game` |
| Codex subscription example | `bun run example:codex` |

---

# Design Principles

## 1. JSX is syntax, not the transport

JSX produces a structured prompt tree. Provider adapters—not components—own wire formats.

## 2. The canonical IR is the contract

Messages, tool schemas, tool-call IDs, and tool-result pairing are validated before provider execution.

## 3. Provider-specific metadata can round-trip without contaminating agent semantics

A provider may need opaque metadata on later turns. Canonical tool calls can preserve namespaced provider metadata while application tools continue to reason only about IDs, names, and JSON arguments.

## 4. Agent mechanics are reusable, application behavior is not hidden

`runAgent()` centralizes the repetitive loop mechanics but does not own your filesystem, database, browser, shell, or domain policy.

## 5. Libraries return data; applications decide presentation

The core is deliberately quiet. Detailed terminal traces belong in examples/CLIs, where they can be designed for humans without surprising library consumers.

---

## License

MIT
