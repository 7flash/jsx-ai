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

## When to use examples vs guides

- Use the example files when you want runnable code you can copy/adapt.
- Use `docs/architecture.md` when you need to understand internal package structure.
- Use `docs/extensibility.md` when you want to add custom providers, strategies, or hooks.
- Use `docs/contributor-ci.md` for test/CI workflow guidance.
- Use `docs/maintainer-release.md` for publishing and release validation.
