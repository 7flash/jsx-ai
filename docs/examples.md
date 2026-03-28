# Examples

## Available example files

### `examples/coding-agent.tsx`

A runnable coding-agent example that demonstrates:
- reusable JSX tool components
- composing multiple tools into a prompt
- inspecting prompt structure with `render()`
- calling `callLLM()` with a concrete user request

Run it with:

```sh
bun run examples/coding-agent.tsx
```

Or pass a custom request:

```sh
bun run examples/coding-agent.tsx "Create src/hello.ts with a greet() function"
```

What it shows:
- `ExecTool`, `ReadFile`, `WriteFile`, `EditFile` as composable JSX components
- a `CodingTools` fragment that groups tools for reuse
- `render(prompt)` to inspect extracted model/tools/messages before the call
- `callLLM(prompt)` to execute the prompt against the configured provider

### `examples/render-prompt.tsx`

A minimal prompt-inspection example.

Run it with:

```sh
bun run examples/render-prompt.tsx
```

What it shows:
- `render()` without a network call
- extracted prompt JSON shape
- model / strategy / tool declaration inspection

### `examples/customizations.tsx`

A runnable extension-point demo.

Run it with:

```sh
bun run examples/customizations.tsx
```

What it shows:
- registering a custom provider
- registering a custom strategy
- registering a telemetry hook
- mocking `fetch` so the flow is demonstrable without a real LLM backend

### `examples/skills.tsx`

A runnable skill discovery/resolution demo.

Run it with:

```sh
bun run examples/skills.tsx
```

What it shows:
- skill discovery with `<Skill path="..." />`
- lazy activation via `<UseSkillTool />`
- simulating `use_skill({ skill_name: ... })`
- resolving full skill content with `resolveSkills()` + `<Skill resolve />`
- sample skill markdown files under `examples/skills/`

### `examples/call-text.ts`

A runnable `callText()` example without JSX.

Run it with:

```sh
bun run examples/call-text.ts
```

What it shows:
- text-in/text-out usage with `callText()`
- OpenAI-compatible request shape
- mocking `fetch` for a self-contained demo

### `examples/stream-text.ts`

A runnable `streamLLM()` example.

Run it with:

```sh
bun run examples/stream-text.ts
```

What it shows:
- chunked token streaming with `streamLLM()`
- local mock SSE server usage
- OpenAI-compatible streaming path without external credentials

### `examples/providers.tsx`

A runnable provider-specific usage demo.

Run it with:

```sh
bun run examples/providers.tsx
```

What it shows:
- Gemini request/response flow
- OpenAI-compatible request/response flow
- Anthropic request/response flow
- explicit `provider="openai"` override on a prompt
- mocked `fetch` responses for each provider path

### `examples/strategies.tsx`

A runnable strategy-specific behavior demo.

Run it with:

```sh
bun run examples/strategies.tsx
```

What it shows:
- how `native`, `xml`, `nlt`, and `hybrid` prepare the same prompt differently
- how each strategy parses representative provider responses
- the difference between native tool calls and text-encoded tool calls

### `examples/natural-strategy.tsx`

A focused runnable demo for the standalone `natural` strategy.

Run it with:

```sh
bun run examples/natural-strategy.tsx
```

What it shows:
- the natural-language system prompt generated for tools
- the `THINKING` / `TOOL_CALL` / `PARAM` / `END_CALL` response format
- how the `natural` strategy parses plain-text tool calls

## When to use examples vs guides

- Use the example files when you want runnable code you can copy/adapt.
- Use `docs/architecture.md` when you need to understand internal package structure.
- Use `docs/extensibility.md` when you want to add custom providers, strategies, or hooks.
- Use `docs/contributor-ci.md` for test/CI workflow guidance.
- Use `docs/maintainer-release.md` for publishing and release validation.
