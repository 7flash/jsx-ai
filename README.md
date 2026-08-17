# jsx-ai

**JSX for structured LLM programs.**

`jsx-ai` lets you compose system instructions, messages, tools, schemas, and agent conversations as JSX, then run the same program through provider APIs or a local Codex runtime.

```tsx
// @jsxImportSource jsx-ai
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a careful coding assistant.</system>

    <tool name="read_file" description="Read a UTF-8 file">
      <param name="path" type="string" required>Project-relative path</param>
    </tool>

    <message role="user">Inspect package.json and summarize the project.</message>
  </>,
)

console.log(result.text)
console.log(result.toolCalls)
console.log(result.usage)
```

No React. No provider-specific request JSON in application code. No logging side effects from the core library.

## Why JSX?

LLM applications are naturally compositional: prompts contain reusable instructions, tools contain schemas, agents contain histories, and larger systems assemble those pieces conditionally.

`jsx-ai` treats JSX as the source language for that structure:

```text
JSX components
      │
      ▼
validated PromptIR
      │
      ├── API runtime
      │     └── strategy → provider adapter → HTTP API
      │
      └── Codex runtime
            └── local Codex App Server → ephemeral thread
      │
      ▼
normalized text + tool calls + usage
```

The invariant is the canonical IR, not a provider wire format. Your application owns side effects and domain state; `jsx-ai` owns prompt normalization, provider/runtime lowering, canonical tool history, and the reusable agent loop.

---

## Install

```bash
bun add jsx-ai
```

or:

```bash
npm install jsx-ai
```

Configure TypeScript JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "jsx-ai"
  }
}
```

`jsx-ai` ships `jsx-runtime` and `jsx-dev-runtime`; React is not required.

---

## Choose a runtime once

Repository examples and normal `callLLM()`/`runAgent()` code do not need provider branches. Runtime selection belongs to `jsx-ai` configuration.

### Provider API runtime

Set a model and its provider credential:

```powershell
$env:JSX_AI_RUNTIME = "api"
$env:JSX_AI_MODEL = "<provider-model-id>"
$env:GEMINI_API_KEY = "..."       # when using Gemini
# $env:OPENAI_API_KEY = "..."     # when using OpenAI
# $env:ANTHROPIC_API_KEY = "..."  # when using Anthropic
```

`jsx-ai` deliberately has **no hard-coded API model default**. Model release cycles are provider-owned; a provider-neutral library should not silently pin applications to one vendor or a model that will later be deprecated.

Model precedence for `callLLM()` is:

```text
callOptions.model
      ↓
JSX_AI_MODEL
      ↓
<prompt model="...">
```

If API mode reaches a call without a model, `jsx-ai` fails with an actionable configuration error.

### ChatGPT-authenticated Codex runtime

Install the optional Codex CLI package and log in once:

```bash
bun add @openai/codex
bunx @openai/codex login
```

Then:

```powershell
$env:JSX_AI_RUNTIME = "codex"
Remove-Item Env:JSX_AI_MODEL -ErrorAction SilentlyContinue
```

With no `JSX_AI_MODEL`, Codex chooses the model from its normal local configuration. You may set `JSX_AI_MODEL` when you intentionally want a library-wide override.

The same JSX application code works in either runtime.

---

## Tools are components

```tsx
const WorkspaceTools = () => (
  <>
    <tool name="list_files" description="List project files" />

    <tool name="read_file" description="Read a UTF-8 file">
      <param name="path" type="string" required>Project-relative path</param>
    </tool>

    <tool name="write_file" description="Write or replace a UTF-8 file">
      <param name="path" type="string" required>Project-relative path</param>
      <param name="content" type="string" required>Complete file contents</param>
    </tool>
  </>
)
```

For nested inputs, use JSON Schema directly:

```tsx
<tool
  name="create_scene"
  description="Create a scene"
  schema={{
    type: "object",
    properties: {
      camera: {
        type: "object",
        properties: {
          fov: { type: "number", minimum: 1, maximum: 179 },
        },
        required: ["fov"],
        additionalProperties: false,
      },
    },
    required: ["camera"],
    additionalProperties: false,
  }}
/>
```

Schemas are normalized and validated before built-in providers receive them.

---

## Agents: let `runAgent()` own the loop

Do not rebuild assistant/tool history and usage accounting by hand. `runAgent()` centralizes the invariant mechanics while leaving tools and application state under your control.

```tsx
// @jsxImportSource jsx-ai
import { runAgent } from "jsx-ai"
import type { CanonicalToolCall, ExtractedMessage } from "jsx-ai"

function Conversation({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <>
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
  )
}

function AgentPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <>
      <system>
        You are an autonomous workspace agent. Inspect existing work before changing it.
      </system>

      <WorkspaceTools />

      <tool name="done" description="Finish only when the task is complete">
        <param name="summary" type="string" required>Completion summary</param>
      </tool>

      <Conversation history={history} />
    </>
  )
}

const state = { done: false }

const result = await runAgent({
  state,
  history: [{ role: "user", content: "Create a polished index.html" }],
  buildPrompt: history => <AgentPrompt history={history} />,

  executeTool: async (call: CanonicalToolCall) => {
    switch (call.name) {
      case "list_files":
        return JSON.stringify(await listFiles())
      case "read_file":
        return await readFile(String(call.args.path))
      case "write_file":
        await writeFile(String(call.args.path), String(call.args.content))
        return "written"
      case "done":
        state.done = true
        return "completion accepted"
      default:
        return { content: `Unknown tool: ${call.name}`, isError: true }
    }
  },

  isComplete: () => state.done,
  maxSteps: 12,
  maxToolCalls: 64,
  maxDurationMs: 5 * 60_000,
})

console.log(result.reason)
console.log(result.usage)
```

`runAgent()` owns:

- canonical assistant/tool-result history;
- stable tool-call IDs;
- provider metadata round-tripping;
- tool/model step budgets;
- input/output token budgets;
- cancellation and overall duration limits;
- no-tool recovery and lifecycle events.

Your application owns:

- the JSX contract;
- actual tool side effects;
- filesystem/database/browser state;
- domain validation;
- the definition of “done”.

### Codex efficiency inside an agent run

When the selected runtime is Codex, `jsx-ai` starts one local App Server child process and one ephemeral Codex thread for the lifetime of a `runAgent()` invocation. The first model step sends the complete contract; later steps reuse that thread and send only newly appended host messages/tool results. The child process is closed when the run completes, stops, aborts, or throws. A new `runAgent()` invocation starts fresh.

`callLLM()`, `callText()`, and `streamLLM()` use the same internal App Server transport; one-shot calls create a one-shot ephemeral thread and close it afterward. You never start or manage App Server yourself. This is intentional for worker architectures where a process handles one bounded phase, exits, and another process may continue from durable application state hours or days later.

---

## Canonical history is structured

Tool calls are not flattened into prose. Canonical history retains assistant tool calls and matching tool-result messages:

```ts
{
  role: "assistant",
  content: "",
  toolCalls: [
    { id: "call_1", name: "read_file", args: { path: "package.json" } }
  ]
}

{
  role: "tool",
  toolCallId: "call_1",
  toolName: "read_file",
  content: "{ ... }"
}
```

Provider-specific metadata required for later turns can round-trip opaquely through the canonical call without leaking into application tool semantics.

Use `render()` when you want to inspect the normalized prompt without sending a model request:

```tsx
import { render } from "jsx-ai"

const prompt = render(
  <>
    <system>You are helpful.</system>
    <message role="user">Hello</message>
  </>,
)

console.log(prompt.messages)
```

---

## API runtime: providers and strategies

Provider routing is inferred from the model name unless you explicitly register/override a provider.

| Model family | Built-in adapter | Typical credential |
|---|---|---|
| `gemini-*` | Gemini | `GEMINI_API_KEY` |
| `gpt-*`, `o*`, `chatgpt*` | OpenAI | `OPENAI_API_KEY` |
| `claude-*` | Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI-compatible custom families | OpenAI/custom adapter | provider-specific |

Strategies control how tools are represented for the API runtime:

| Strategy | Purpose |
|---|---|
| `auto` | current library default policy |
| `native` | provider-native function/tool calling |
| `hybrid` | native tools plus behavioral guidance |
| `natural` | natural-language action blocks |
| `nlt` | explicit natural-language tool-selection protocol |
| `xml` | XML tool schema/response protocol |

Codex does not use an API strategy; it uses its structured bridge while preserving the same `LLMResponse` and `runAgent()` contracts.

Sampling controls such as `temperature` are provider/model capabilities, not portable guarantees. `jsx-ai` does not send deprecated temperature settings to modern Gemini generations.

---

## Runtime resolution

`callLLM()` accepts explicit overrides when an application needs them:

```ts
await callLLM(tree, {
  runtime: "api",
  model: "<model-id>",
  strategy: "native",
  timeoutMs: 60_000,
})
```

Explicit options win over environment configuration. Repository examples intentionally avoid these overrides so they can run unchanged under either runtime.

Useful environment variables:

| Variable | Meaning |
|---|---|
| `JSX_AI_RUNTIME` | `api` or `codex` |
| `JSX_AI_MODEL` | optional model override; required somewhere for API `callLLM()` |
| `GEMINI_API_KEY` | Gemini API credential |
| `OPENAI_API_KEY` | OpenAI API credential |
| `ANTHROPIC_API_KEY` | Anthropic API credential |
| `JSX_AI_EXPLORER_URL` | optional model-call telemetry sink |

---

## Observability

The core library is silent: it does not print routine logs and does not import `measure-fn`.

Structured information is available through:

- `LLMResponse` for model text, tool calls, finish reason, usage, and request diagnostics;
- `AgentRunResult` for cumulative usage, steps, stop reason, tool count, and elapsed time;
- `runAgent({ onTextDelta, onEvent })` for streamed assistant text plus model/tool lifecycle and optional runtime progress;
- `registerHook()` for model-call telemetry.

Repository examples use `measure-fn` as a development-only presentation layer. The game builder reports model/tool timing, token usage, generated file sizes, Codex bridge diagnostics, and real intermediate Codex progress while a model step is still running.

### Stream assistant words during an agent run

The common application UI should not have to choose between an agent API and a text-stream API. Use `runAgent()` once and render two simple surfaces:

- `onTextDelta` — append real assistant-visible words while the current model step is still generating;
- `onEvent` — show atomic tool lifecycle (`tool_start`, `tool_end`) and completion.

```tsx
await runAgent({
  history,
  buildPrompt,
  executeTool,

  onTextDelta({ delta }) {
    chat.appendAssistantText(delta)
  },

  onEvent(event) {
    if (event.type === "tool_start") {
      chat.setActivity(`Running ${event.call.name}…`)
    }

    if (event.type === "tool_end") {
      chat.setActivity("")
    }

    if (event.type === "stop") {
      chat.finish(event.reason)
    }
  },
})
```

For Codex, `jsx-ai` receives the in-flight structured response, incrementally decodes only its top-level assistant `text` field, and forwards that decoded text through `onTextDelta`. Tool-call JSON remains private until the whole response has completed and passed schema/tool validation.

Conceptually:

```text
model step starts
    │
    ├── text: "I'll inspect "  ─────→ onTextDelta({ delta: "I'll inspect " })
    ├── text: "the project."  ─────→ onTextDelta({ delta: "the project." })
    │
    └── structured toolCalls JSON
              │
              │ buffered inside jsx-ai
              ▼
         complete + validate
              │
              ├── tool_start
              ├── executeTool()
              └── tool_end
```

The callback never receives partial `toolCalls`, partial `arguments_json`, or partial `write_file.content`. It also never exposes hidden chain-of-thought. Concatenating the text deltas for a successful step reconstructs that step's final visible `response.text`.

Codex can additionally emit `runtime_progress` events through `onEvent` for diagnostics such as normalized status/activity/warnings. Those are optional and are not required for a normal chat UI.

Runtimes that do not yet expose structured assistant-text deltas still honor the same `onTextDelta` callback by delivering the final visible assistant text once before `model_end`. This keeps the application contract stable while runtime-specific streaming support improves independently.

Run the practical example:

```bash
bun run example:streaming
```

It shows assistant text arriving while each model step is running, followed by atomic host-tool events.

### Plain text streaming without an agent

Use `streamLLM()` when there are no structured application tools and you simply want a text stream:

```ts
for await (const chunk of streamLLM([
  { role: "user", content: "Write a short explanation of JSX." },
])) {
  process.stdout.write(chunk)
}
```

`streamLLM()` works with both API and Codex runtimes. A yielded chunk is a transport text delta, not a guaranteed one-token boundary. Under Codex, `jsx-ai` consumes App Server `item/agentMessage/delta` notifications from the local child process.

Use this rule of thumb:

```text
structured agent with tools  → runAgent({ onTextDelta, onEvent })
plain text generation        → streamLLM()
```

Core code returns facts; applications decide how those facts should be displayed.

---

## Skills

Skills provide two-phase context loading from Markdown files with frontmatter:

```md
---
name: bun-expert
description: Bun runtime expertise
---

Use Bun.serve, bun:sqlite, and bun:test where appropriate.
```

Discovery keeps context small:

```tsx
<>
  <Skill path="skills/bun-expert.md" />
  <Skill path="skills/security.md" />
  <UseSkillTool />
</>
```

Resolve only what the agent requests:

```tsx
<Skill path="skills/bun-expert.md" resolve />
```

See `examples/skills-agent.tsx` for an observable end-to-end example.

---

## Lower-level APIs

### `callLLM(tree, options?)`

Use for structured JSX prompts and tool calls. Runtime/model may come from environment configuration.

### `callText(messages, options?)` / `callText(model, messages, options?)`

Use for simple text-only calls. The messages-first form resolves runtime/model through the same `JSX_AI_*` configuration as `callLLM()`; the positional-model form remains available when you want an explicit override.

```ts
const text = await callText([
  { role: "system", content: "Be concise." },
  { role: "user", content: "Summarize this change." },
])
```

### `streamLLM(messages, options?)` / `streamLLM(model, messages, options?)`

Streams user-visible assistant text deltas under either runtime. API runtimes use the provider's streaming transport. Codex uses the local Codex App Server delta event (`item/agentMessage/delta`) while keeping child-process management internal to `jsx-ai`.

A yielded chunk is not guaranteed to equal one tokenizer token. `streamLLM()` is also distinct from `runAgent()`'s `runtime_progress`: the former is visible assistant text; the latter is structured status/activity inside a model step.

### Registry extension points

```ts
const disposeProvider = registerProvider(myProvider)
const disposeStrategy = registerStrategy(myStrategy)

// later

disposeProvider()
disposeStrategy()
```

Registration returns a disposer so tests/plugins do not permanently pollute global registries.

---

## Errors

Transport/runtime failures use exported error classes and stable codes:

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

Prefer error identity/codes over parsing message strings.

---

## Examples

All examples are runtime-neutral and intentionally observable.

```bash
bun run example:coding
bun run example:skills
bun run example:runtime
bun run example:text-stream
bun run example:streaming
bun run example:game
```

Set `JSX_AI_RUNTIME` / `JSX_AI_MODEL` outside the example; do not edit the source to switch backends.

### `examples/runtime-agent.tsx`

Small reference agent showing the recommended boundary: JSX defines the contract, `runAgent()` owns loop mechanics, and the application owns host tools.

### `examples/text-stream.ts`

Small runtime-neutral text example using `streamLLM(messages)`. Under Codex it prints real `item/agentMessage/delta` assistant text as the local Codex turn generates it; under API runtime it prints provider text deltas. It also reports chunk count, character count, time to first chunk, and total elapsed time with `measure-fn`.

### `examples/streaming-agent.tsx`

Minimal two-step structured agent showing the common UI contract: `onTextDelta` renders assistant words as they arrive while `tool_start` / `tool_end` remain atomic. Codex runtime-progress events remain available as optional diagnostics.

### `examples/game-builder-agent.tsx`

A larger three-phase worker-style example:

1. build a playable Canvas game;
2. inspect durable workspace files and improve gameplay;
3. start a fresh agent phase and migrate the renderer.

Each phase has fresh conversation history. The generated workspace is the durable state between phases, matching systems where the next worker/process may run much later.

---

## Benchmark

```bash
JSX_AI_MODEL=<model-id> bun run bench
```

or use the Codex runtime/model configuration you intentionally want to evaluate.

The benchmark records final task outcomes under equal budgets, usage, latency, tool activity, stopping conditions, infrastructure failures, and evaluator results. It does not publish a timeless strategy leaderboard because model/runtime behavior changes.

Benchmarks should always be reported with their model/runtime, scenario, budgets, iteration count, and run date.

---

## Development

```bash
bun install
bun run typecheck
bun test
bun run check
```

Useful scripts:

```text
example:coding   one observable structured tool call
example:skills   skill discovery/resolution
example:runtime      recommended runtime-neutral host-tool agent
example:text-stream  visible assistant text-delta stream (API or Codex)
example:streaming    practical streamed agent UI: text deltas + atomic tools
example:game         multi-phase observable game-building agent
bench            end-to-end strategy benchmark
```

---

## Design principles

1. **JSX is source syntax, not transport.** Provider adapters own wire formats.
2. **The canonical IR is the contract.** Invalid tool schemas/history fail before provider execution.
3. **Runtime choice is configuration.** Application examples do not branch on Gemini/OpenAI/Codex.
4. **Agents own domain state through tools.** `runAgent()` owns repetitive conversation mechanics, not your filesystem/database/browser.
5. **No hidden provider default.** API models must be selected intentionally; Codex may inherit its own configured model.
6. **Core stays quiet.** Structured telemetry is returned; presentation belongs to applications and examples.
7. **Durable application state beats hidden long-lived chat state.** Separate agent runs can reconstruct what matters from files/database/domain state.

---

## License

MIT
