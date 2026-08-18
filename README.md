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
          attachments={message.attachments}
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

### Multimodal agent history

Canonical user and tool-result messages may carry local image attachments alongside their text. This is the foundation for browser screenshots, visual references, image-search results, and generated assets:

```ts
return {
  content: "Current game after holding ArrowRight for two seconds.",
  attachments: [
    {
      type: "image",
      path: ".agent/screenshots/movement-004.png",
      mimeType: "image/png",
      alt: "Running game viewport after movement test",
    },
  ],
}
```

`runAgent()` appends that as a normal canonical tool result. On the next Codex model step, `jsx-ai` sends the new attachment as a native App Server `localImage` input while retaining the text/tool-result pairing in canonical history. Relative paths are resolved against `callOptions.codex.workingDirectory` when set, otherwise the current process directory.

When JSX renders canonical history back into the next prompt, preserve attachments just like tool-call fields:

```tsx
<message
  role={message.role}
  toolCalls={message.toolCalls}
  toolCallId={message.toolCallId}
  toolName={message.toolName}
  isError={message.isError}
  attachments={message.attachments}
>
  {message.content}
</message>
```

Image-only user/tool observations are valid (`content: ""` plus at least one attachment). Assistant messages do not accept attachments; generated images should enter history through an application tool result.

Codex is the first runtime wired to canonical local-image attachments. API runtime currently fails clearly when attachments are present instead of silently discarding them; provider-specific multimodal lowering can be added without changing the canonical message shape.

Within one Codex `runAgent()` invocation, attachments follow the same delta-history rule as text: an image is sent when its message is newly appended, not re-sent on every later turn. If history is rewritten and the native thread must resynchronize, the required attachments are sent again with that fresh thread.

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
- `runAgent({ onEvent })` for one ordered stream of assistant text, progressive tool construction, and model/tool lifecycle;
- `onTextDelta` / `onToolProgress` as convenience callbacks when separate handlers are preferable;
- `registerHook()` for model-call telemetry.

Repository examples use `measure-fn` as a development-only presentation layer. The game builder reports model/tool timing, token usage, generated file sizes, Codex bridge diagnostics, and real intermediate Codex progress while a model step is still running.

### Stream a practical agent UI

For an application with tools, use `runAgent()` once. The simplest production interface is one ordered `onEvent` callback. It includes the words the agent is saying, the tool call it is preparing, and the later host execution lifecycle.

```tsx
let generatedChars = 0
let preparedPath = ""

await runAgent({
  history,
  buildPrompt,
  executeTool,

  onEvent(event) {
    if (event.type === "text_delta") {
      chat.appendAssistantText(event.delta)
      return
    }

    if (event.type === "tool_progress") {
      const progress = event.progress

      if (progress.type === "tool_detected") {
        chat.setActivity(`Preparing ${progress.name}…`)
      }

      if (progress.type === "field_ready" && progress.path[0] === "path") {
        preparedPath = String(progress.value)
        chat.setActivity(`Preparing ${preparedPath}…`)
      }

      if (progress.type === "field_delta" && progress.path[0] === "content") {
        generatedChars += progress.delta.length
        chat.setActivity(`${preparedPath || "file"} · ${generatedChars} characters generated…`)
      }

      if (progress.type === "tool_ready") {
        chat.setActivity(`${progress.call.name} ready`)
      }
      return
    }

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

The same ordered callback can be forwarded over SSE or WebSocket after projecting away any application-only context you do not want on the wire. Event handlers are awaited in emission order, so a slow async handler applies backpressure instead of allowing later tool-progress or execution events to overtake earlier text.

If an application prefers separate handlers, `onTextDelta` and `onToolProgress` remain convenience callbacks. They receive the same semantic data as `text_delta` and `tool_progress` respectively.

The generation/execution boundary is intentional:

```text
model step starts
    │
    ├── assistant text ───────────────→ text_delta
    │
    └── tool call being constructed
          │
          ├── name complete ─────────→ tool_progress: tool_detected
          ├── path complete ─────────→ tool_progress: field_ready(path)
          ├── content chunks ────────→ tool_progress: field_delta(content)
          ├── content complete ──────→ tool_progress: field_ready(content)
          │
          └── complete canonical call
                    │
                    └───────────────→ tool_progress: tool_ready
                                         │
                          execution boundary
                                         │
                                      tool_start
                                         │
                                      executeTool()
                                         │
                                      tool_end
```

`tool_progress` never executes a tool. It is observability/UI data only. `tool_ready` means the model turn has produced a complete canonical call; actual side effects still begin at `tool_start`.

For Codex, `jsx-ai` incrementally decodes the structured response instead of exposing partial JSON. Applications receive semantic events, not fragments such as `{"toolCalls":[{"na`. String argument values can produce `field_delta` events as their decoded contents arrive. A completed primitive/string/object/array argument produces `field_ready`. Nested object/array values are currently surfaced atomically at their top-level argument path.

A tool may theoretically stream arguments before its `name` field. In that unusual case `field_delta` / `field_ready` identify the tool by `index` and omit `name` until `tool_detected` arrives. Application code should therefore use `index` as the stable in-progress identity and treat `name` on field events as optional until `tool_detected` arrives.

Runtimes that do not yet expose progressive structured-tool data still honor the same event contract at turn completion: `jsx-ai` emits final `tool_detected`, top-level `field_ready`, and `tool_ready` events before execution. Likewise, runtimes without assistant text deltas emit the final visible text once as `text_delta`. This keeps application code runtime-neutral.

`runtime_progress` remains available through `onEvent` for optional provider/runtime diagnostics. A normal product UI does not need it.

Run the practical example:

```bash
bun run example:streaming
```

It uses only `onEvent` and shows assistant words arriving, a tool becoming visible while its fields are generated, and the later atomic host execution as separate phases.

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
structured agent with tools  → runAgent({ onEvent })
separate callback style      → onTextDelta + onToolProgress (optional convenience)
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

Practical structured-agent UI using one ordered `onEvent` stream: `text_delta` for assistant words, `tool_progress` for a tool/field being prepared, and atomic `tool_start` / `tool_end` for actual host execution. The example counts generated content characters without printing the tool payload itself.

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
