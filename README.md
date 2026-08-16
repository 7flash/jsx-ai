# jsx-ai

[![npm](https://img.shields.io/npm/v/jsx-ai.svg?style=flat-square)](https://www.npmjs.com/package/jsx-ai)
[![bundle](https://img.shields.io/bundlephobia/minzip/jsx-ai?style=flat-square\&label=size)](https://bundlephobia.com/package/jsx-ai)

**JSX for structured LLM calls.**

Define prompts, messages, tools, skills, and agent conversations as composable JSX components. `jsx-ai` handles provider-specific request formats, tool encodings, response parsing, retries, and usage reporting.

No React. No framework runtime. Just JSX as a typed prompt DSL.

```tsx
import { callLLM } from "jsx-ai"

const result = await callLLM(
  <>
    <system>You are a coding agent</system>

    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>
        The command to run
      </param>
    </tool>

    <message role="user">
      List all TypeScript files
    </message>
  </>,
  { model: "gemini-3-flash-preview" },
)

result.toolCalls
// [{ name: "exec", args: { command: "find . -name '*.ts'" } }]

result.text
// ""

result.usage
// { inputTokens: 42, outputTokens: 15 }
```

## Installation

```sh
bun add jsx-ai
```

or:

```sh
npm install jsx-ai
```

Configure JSX in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "jsx-ai"
  }
}
```

`jsx-ai` ships its own JSX runtime. React is not required.

---

## Why JSX?

LLM APIs expose similar concepts—system instructions, messages, tools, parameters—but encode them differently.

Without an abstraction, tool definitions quickly become deeply nested provider-specific JSON:

```ts
const response = await fetch(url, {
  body: JSON.stringify({
    model: "gemini-3-flash-preview",
    systemInstruction: {
      parts: [{ text: "You are a coding agent" }],
    },
    tools: [
      {
        functionDeclarations: [
          {
            name: "exec",
            description: "Run a shell command",
            parameters: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: "The command to run",
                },
              },
              required: ["command"],
            },
          },
        ],
      },
    ],
    contents: [
      {
        role: "user",
        parts: [{ text: "List all TypeScript files" }],
      },
    ],
  }),
})

const data = await response.json()
const toolCall =
  data.candidates[0].content.parts[0].functionCall
```

With `jsx-ai`, the same call becomes a reusable component tree:

```tsx
import { callLLM } from "jsx-ai"

const ExecTool = () => (
  <tool name="exec" description="Run a shell command">
    <param name="command" type="string" required>
      The command to run
    </param>
  </tool>
)

const result = await callLLM(
  <>
    <system>You are a coding agent</system>
    <ExecTool />

    <message role="user">
      List all TypeScript files
    </message>
  </>,
  {
    model: "gemini-3-flash-preview",
  },
)

result.toolCalls
// [{ name: "exec", args: { command: "find . -name '*.ts'" } } }]
```

The prompt tree stays the same if you switch providers:

```tsx
await callLLM(tree, {
  model: "gemini-3-flash-preview",
})

await callLLM(tree, {
  model: "gpt-4o",
})

await callLLM(tree, {
  model: "claude-3-sonnet-20240229",
})
```

---

## What You Get

* **Provider-agnostic prompts** — Gemini, OpenAI, Anthropic, and DeepSeek
* **Composable JSX** — tools, messages, prompts, and skills are ordinary components
* **Tool calling** — structured tool declarations and normalized tool-call results
* **Five tool strategies** — `native`, `nlt`, `xml`, `natural`, and `hybrid`
* **Agent loops** — preserve assistant messages and tool results across turns
* **Skills** — lightweight discovery followed by selective skill resolution
* **Streaming** — token-by-token text generation
* **Usage reporting** — normalized input/output token accounting
* **Custom providers** — register additional model backends
* **Custom strategies** — plug in alternative tool encodings/parsers
* **TypeScript-first** — typed API and custom JSX runtime
* **No React dependency** — JSX is only the interface
* **Benchmarked strategies** — compare tool encodings on multi-turn agent tasks

---

# Quick Start

## Text + tools

```tsx
import { callLLM } from "jsx-ai"

const SearchTool = () => (
  <tool
    name="search"
    description="Search the project"
  >
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
  {
    model: "gemini-3-flash-preview",
  },
)

console.log(result.text)
console.log(result.toolCalls)
console.log(result.usage)
```

---

# Agent Loops

`callLLM()` returns normalized assistant text and tool calls, making multi-turn agents straightforward.

```tsx
import { callLLM } from "jsx-ai"
import type {
  ExtractedMessage,
  ToolCall,
} from "jsx-ai"

const history: ExtractedMessage[] = []

function promptTree() {
  return (
    <prompt
      model="gemini-3-flash-preview"
      strategy="hybrid"
      temperature={0.2}
      maxTokens={14000}
    >
      <system>
        You are an autonomous coding agent.
      </system>

      <tool name="read_file" description="Read a file">
        <param name="path" type="string" required>
          File path
        </param>
      </tool>

      <tool name="write_file" description="Write a file">
        <param name="path" type="string" required>
          File path
        </param>
        <param name="content" type="string" required>
          Complete file contents
        </param>
      </tool>

      {history.map((message) => (
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
    </prompt>
  )
}
```

Run a turn:

```tsx
const result = await callLLM(promptTree(), {
  model: "gemini-3-flash-preview",
  strategy: "hybrid",
  retries: 3,
  timeoutMs: 90_000,
})

history.push({
  role: "assistant",
  content: result.text || "",
  toolCalls: result.toolCalls,
})
```

Then execute each tool and append its result:

```ts
for (const call of result.toolCalls) {
  history.push(executeTool(call))
}
```

This makes the conversation itself the agent state.

---

# JSX Elements

## `<system>`

Defines the system instruction.

```tsx
<system>
  You are a senior TypeScript engineer.
</system>
```

---

## `<message>`

Adds a conversation message.

```tsx
<message role="user">
  Refactor the database layer.
</message>
```

Assistant and tool history can be reconstructed using message metadata:

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

---

## `<tool>`

Declares a callable function.

```tsx
<tool
  name="exec"
  description="Run a shell command"
>
  <param name="command" type="string" required>
    Command to execute
  </param>
</tool>
```

---

## `<param>`

Defines tool parameters.

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

---

## `<prompt>`

Optionally configures a subtree:

```tsx
<prompt
  model="gemini-3-flash-preview"
  strategy="hybrid"
  temperature={0.2}
  maxTokens={14000}
>
  ...
</prompt>
```

Configuration may also be supplied to `callLLM()`.

---

# Composable Tools

Tools are ordinary JSX components:

```tsx
const ReadFileTool = () => (
  <tool
    name="read_file"
    description="Read a UTF-8 file"
  >
    <param name="path" type="string" required>
      Project-relative file path
    </param>
  </tool>
)

const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write or replace a UTF-8 file"
  >
    <param name="path" type="string" required>
      Project-relative file path
    </param>

    <param name="content" type="string" required>
      Complete file contents
    </param>
  </tool>
)
```

Compose them like normal components:

```tsx
const CodingTools = () => (
  <>
    <ReadFileTool />
    <WriteFileTool />
  </>
)

await callLLM(
  <>
    <system>You are a coding agent</system>
    <CodingTools />
    <message role="user">
      Inspect the project and fix the bug.
    </message>
  </>,
)
```

---

# Providers

Providers are automatically inferred from the model name.

The default model is:

```text
gemini-3-flash-preview
```

| Model           | Provider                     | Authentication        | Environment variable |
| --------------- | ---------------------------- | --------------------- | -------------------- |
| `gemini-*`      | Gemini                       | `x-goog-api-key`      | `GEMINI_API_KEY`     |
| `gpt-*`, `o4-*` | OpenAI                       | Bearer                | `OPENAI_API_KEY`     |
| `claude-*`      | Anthropic                    | `x-api-key` + version | `ANTHROPIC_API_KEY`  |
| `deepseek-*`    | DeepSeek / OpenAI-compatible | Bearer                | `DEEPSEEK_API_KEY`   |

## Gemini

```tsx
await callLLM(tree, {
  model: "gemini-3-flash-preview",
})
```

## OpenAI

```tsx
await callLLM(tree, {
  model: "gpt-4o",
})
```

## Anthropic

```tsx
await callLLM(tree, {
  model: "claude-3-sonnet-20240229",
})
```

## Force a provider

Provider detection can be overridden explicitly:

```tsx
await callLLM(tree, {
  provider: "openai",
  model: "my-compatible-model",
})
```

Provider-specific behavior is normalized internally.

Examples include:

* Gemini merging consecutive same-role messages where required by the API
* OpenAI `o4-*` requests using `max_completion_tokens` and the required temperature behavior
* Anthropic system prompts being moved to the top-level system field
* Anthropic tool declarations using `input_schema`
* Anthropic `tool_use` responses being normalized into `toolCalls`
* DeepSeek requests being sent using its OpenAI-compatible API format

---

# Custom Providers

Register your own provider implementation:

```tsx
import {
  callLLM,
  registerProvider,
} from "jsx-ai"

import type { Provider } from "jsx-ai"

class MyProvider implements Provider {
  name = "custom"

  buildRequest(prepared, model, apiKey) {
    // Convert the normalized jsx-ai prompt
    // into your provider request.
  }

  parseResponse(data) {
    // Convert provider output into the
    // normalized jsx-ai response.
  }
}

registerProvider("custom", new MyProvider())

const result = await callLLM(
  <>
    <message role="user">
      Hello
    </message>
  </>,
  {
    provider: "custom",
    model: "my-model",
  },
)
```

---

# Tool Strategies

One JSX prompt can be encoded for the model in different ways.

| Strategy  | Tools sent as                      | Tool calls parsed from    | Good for                      |
| --------- | ---------------------------------- | ------------------------- | ----------------------------- |
| `native`  | Provider API `tools`               | Structured function calls | Simple tool use, low overhead |
| `nlt`     | Text descriptions + native FC      | Structured function calls | Multi-turn agents             |
| `xml`     | XML tool schema in text            | XML responses             | Multi-tool batching           |
| `natural` | Natural-language tool descriptions | Action blocks             | Reasoning-heavy tool use      |
| `hybrid`  | Native API tools + textual schema  | Either                    | General-purpose agents        |

Choose a strategy through options:

```tsx
await callLLM(tree, {
  model: "gemini-3-flash-preview",
  strategy: "nlt",
})
```

Or through `<prompt>`:

```tsx
<prompt strategy="hybrid">
  ...
</prompt>
```

---

## Custom Strategies

Strategies are extensible:

```tsx
import { registerStrategy } from "jsx-ai"

registerStrategy("my-strategy", {
  prepare,
  parseResponse,
})
```

---

# Benchmark Results

Example benchmark using **Gemini 2.5 Flash** on a three-turn KV-store agent scenario:

**Plan → Execute → Adapt**

| Strategy    | Turn 1 | Turn 2 | Turn 3 |   Total |
| ----------- | -----: | -----: | -----: | ------: |
| **nlt**     |   100% |    73% |    84% | **86%** |
| **natural** |   100% |    67% |    69% | **79%** |
| **native**  |    46% |     5% |    33% | **28%** |

In this scenario, native function calling often batches homogeneous tool calls—for example several `use_skill` calls—while omitting another action required during the same turn.

The benchmark is intended to compare strategy behavior, not establish one universally optimal encoding.

---

# Skills

`jsx-ai` supports two-phase skill loading from Markdown files with YAML frontmatter.

A skill can contain substantial domain knowledge without injecting all of it into every request.

Example:

```md
---
name: bun-expert
description: Bun runtime expertise — Bun.serve(), bun:sqlite, bun:test
---

## Bun Runtime

- HTTP: use Bun.serve()
- Database: import { Database } from "bun:sqlite"
- Testing: import { describe, it, expect } from "bun:test"
```

## Phase 1 — Discovery

Expose only the lightweight skill catalog:

```tsx
import {
  callLLM,
  Skill,
  UseSkillTool,
} from "jsx-ai"

await callLLM(
  <>
    <Skill path="skills/bun-expert.md" />
    <Skill path="skills/security.md" />

    <UseSkillTool />

    <message role="user">
      Build a KV store API.
    </message>
  </>,
  {
    model: "gemini-3-flash-preview",
  },
)
```

The model initially sees lightweight entries such as:

```text
Available skill: bun-expert — Bun runtime expertise
```

It can then request:

```ts
use_skill({
  skill_name: "bun-expert",
})
```

---

## Phase 2 — Resolution

Resolve only the requested skills:

```tsx
import {
  callLLM,
  Skill,
  resolveSkills,
} from "jsx-ai"

const resolved = resolveSkills(
  skillPaths,
  ["bun-expert"],
)

await callLLM(
  <>
    <Skill
      path="skills/bun-expert.md"
      resolve
    />

    <Skill path="skills/security.md" />

    <message role="user">
      Now implement it.
    </message>
  </>,
  {
    model: "gemini-3-flash-preview",
  },
)
```

The requested skill expands to its complete methodology while unresolved skills remain lightweight catalog entries.

This keeps prompts smaller while still giving agents access to larger collections of specialized instructions.

---

# Inspect Prompts with `render()`

Use `render()` to inspect a JSX prompt without sending anything to a model.

```tsx
import { render } from "jsx-ai"

const extracted = render(
  <>
    <system>You are helpful</system>

    <tool
      name="exec"
      description="Run command"
    >
      <param
        name="command"
        type="string"
        required
      >
        Command
      </param>
    </tool>

    <message role="user">
      List files
    </message>
  </>,
)

extracted.system
// "You are helpful"

extracted.tools
// [{ name: "exec", parameters: { ... } }]

extracted.messages
// [{ role: "user", content: "List files" }]
```

This is useful for testing reusable prompt components and inspecting what the provider layer will receive.

---

# `callLLM()`

Use `callLLM()` when you need structured prompts, tools, or normalized tool-call output.

```tsx
const result = await callLLM(tree, {
  model: "gemini-3-flash-preview",
  strategy: "hybrid",
  temperature: 0.1,
  maxTokens: 4000,
})
```

The result exposes normalized fields such as:

```ts
result.text
result.toolCalls
result.usage
```

---

## Call Options

| Field         | Type                                                  | Default                    | Description                            |
| ------------- | ----------------------------------------------------- | -------------------------- | -------------------------------------- |
| `model`       | `string`                                              | `"gemini-3-flash-preview"` | Model name and automatic provider hint |
| `provider`    | `"gemini" \| "openai" \| "anthropic"`                 | auto                       | Force a provider                       |
| `strategy`    | `"native" \| "nlt" \| "xml" \| "natural" \| "hybrid"` | `"auto"`                   | Tool encoding strategy                 |
| `apiKey`      | `string`                                              | environment                | Override provider API key              |
| `temperature` | `number`                                              | `0.1`                      | Sampling temperature                   |
| `maxTokens`   | `number`                                              | `4000`                     | Maximum output tokens                  |
| `retries`     | `number`                                              | implementation default     | Retry failed model calls               |
| `timeoutMs`   | `number`                                              | implementation default     | Request timeout                        |

---

# `callText()`

For simple text-in/text-out requests, JSX is optional.

```ts
import { callText } from "jsx-ai"

const text = await callText(
  "gemini-3-flash-preview",
  [
    {
      role: "system",
      content:
        "You are a planner. Break tasks into concrete steps.",
    },
    {
      role: "user",
      content:
        "Build a REST API with authentication.",
    },
  ],
)

console.log(text)
```

Example output:

```text
1. Define the API surface
2. Add authentication middleware
3. Implement persistence
4. Add authorization rules
5. Add tests
```

---

# `streamLLM()`

Stream model output token-by-token:

```ts
import { streamLLM } from "jsx-ai"

for await (
  const chunk of streamLLM(
    "gemini-3-flash-preview",
    [
      {
        role: "system",
        content: "You are a storyteller",
      },
      {
        role: "user",
        content: "Tell me a short story",
      },
    ],
  )
) {
  process.stdout.write(chunk)
}
```

`callText()` and `streamLLM()` use the same provider routing and authentication system.

## Text / Streaming Options

| Field         | Type     | Default     | Description               |
| ------------- | -------- | ----------- | ------------------------- |
| `temperature` | `number` | `0.3`       | Sampling temperature      |
| `maxTokens`   | `number` | `8000`      | Maximum output tokens     |
| `apiKey`      | `string` | environment | Override provider API key |

---

# Markdown with `md`

For larger prompt sections, `md` keeps indentation readable:

```tsx
import {
  callLLM,
  md,
} from "jsx-ai"

const result = await callLLM(
  <>
    <system>{md`
      You are an autonomous browser-game engineer.

      Requirements:
      - Inspect existing files before changing them.
      - Keep the codebase small.
      - Do not claim completion until the game is playable.
    `}</system>

    <message role="user">{md`
      Improve game feel and progression.

      Preserve the strongest existing mechanics.
    `}</message>
  </>,
  {
    model: "gemini-3-flash-preview",
  },
)
```

---

# Example: File-Building Agent

Tools can be combined into a bounded autonomous loop:

```tsx
import {
  callLLM,
  md,
} from "jsx-ai"

import type {
  ExtractedMessage,
  ToolCall,
} from "jsx-ai"

const MODEL =
  process.env.GAME_MODEL ||
  "gemini-3-flash-preview"

const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write or replace a UTF-8 project file"
  >
    <param name="path" type="string" required>
      Project-relative path
    </param>

    <param name="content" type="string" required>
      Complete file contents
    </param>
  </tool>
)

const ReadFileTool = () => (
  <tool
    name="read_file"
    description="Read a UTF-8 project file"
  >
    <param name="path" type="string" required>
      Project-relative path
    </param>
  </tool>
)

const PhaseDoneTool = () => (
  <tool
    name="phase_done"
    description="Finish the phase after its goal is fully implemented"
  >
    <param name="summary" type="string" required>
      What changed
    </param>
  </tool>
)

function promptTree(
  history: ExtractedMessage[],
) {
  return (
    <prompt
      model={MODEL}
      strategy="hybrid"
      temperature={0.2}
      maxTokens={14000}
    >
      <system>{md`
        You are an autonomous software engineer.

        Work inside the existing project using the provided tools.
        Inspect relevant files before modifying existing code.
        Keep the implementation coherent.
        Do not call phase_done until the requested work is actually complete.
      `}</system>

      <WriteFileTool />
      <ReadFileTool />
      <PhaseDoneTool />

      {history.map((message) => (
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
    </prompt>
  )
}
```

This pattern works well for coding agents, game builders, migration agents, research workflows, and other iterative tasks where the model must observe tool results before deciding what to do next.

---

# Environment Variables

Set the API key for whichever provider you use:

```sh
# Gemini
GEMINI_API_KEY=...

# OpenAI
OPENAI_API_KEY=...

# Anthropic
ANTHROPIC_API_KEY=...

# DeepSeek
DEEPSEEK_API_KEY=...
```

With no explicit model override, use:

```text
gemini-3-flash-preview
```

as the default model.

---

# Design Philosophy

`jsx-ai` keeps three concerns separate:

```text
JSX prompt
    │
    ▼
normalized prompt representation
    │
    ├── provider adapter
    │
    └── strategy adapter
            │
            ▼
          model
            │
            ▼
normalized text + tool calls + usage
```

Your application owns the agent loop and tool execution.

`jsx-ai` owns the boundary between your structured prompt and the model API.

That means tools remain application code, prompts remain composable, and provider-specific request formats stay out of your agent logic.

---

## License

MIT
