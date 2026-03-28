# Troubleshooting

This guide covers the most common `jsx-ai` setup, runtime, and CI problems.

## `No API key found for ...`

Symptoms:
- `callLLM()` throws before making a request
- `callText()` or `streamLLM()` fails immediately with a missing key error

What to check:
1. pass `apiKey` explicitly for the current call
2. set the provider-specific env var
3. confirm `.config.toml` exists in the current working directory if you rely on it
4. confirm the model/provider pairing is what you expect

Examples:

```sh
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

or:

```ts
await callLLM(prompt, {
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
})
```

See also: [Configuration & compatibility guide](./configuration.md)

## Wrong provider selected

Symptoms:
- you expected OpenAI-compatible routing but the request went to Gemini
- auth headers do not match the backend you intended to use
- a custom model name is treated as the wrong provider

Why it happens:
- provider is auto-detected from the model name unless overridden

Fixes:
- use a model prefix that matches built-in detection rules
- or override the provider explicitly

```ts
await callLLM(tree, {
  provider: "openai",
  model: "custom-openai-route",
})
```

Provider detection summary:
- `gpt-*`, `o*`, `chatgpt*` → `openai`
- `claude*` → `anthropic`
- `deepseek*`, `qwen*` → `openai`
- everything else → `gemini`

## Requests going to the wrong base URL

Symptoms:
- local gateway not being used
- requests still going to hosted OpenAI/DeepSeek/Qwen endpoints
- CI/local behavior mismatch

What to check:
- `OPENAI_API_URL`
- `DEEPSEEK_BASE_URL`
- `DASHSCOPE_BASE_URL`
- trailing slash / expected `/v1` prefix

Quick examples:

```sh
OPENAI_API_URL=http://localhost:1234/v1
OPENAI_API_KEY=dummy
```

```sh
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=...
```

```sh
DASHSCOPE_BASE_URL=https://coding-intl.dashscope.aliyuncs.com/v1
DASHSCOPE_API_KEY=...
```

## Fresh clone tests fail

Symptoms:
- `bun test` fails right after cloning
- runtime import errors for optional dependencies or missing installed packages

Fix:

```sh
bun install
bun test
```

Use this order on a fresh checkout before assuming the suite is broken.

See also: [Contributor CI & test guide](./contributor-ci.md)

## Consumer smoke test fails

Symptoms:
- `bun run test:smoke` fails
- consumer import path validation fails in temp-project setup

What it usually means:
- packaging/export surface changed
- publish artifact shape changed
- example/docs changes touched installation or import assumptions

What to do:
1. run the focused command locally:
   ```sh
   bun run test:smoke
   ```
2. inspect recent changes to:
   - `package.json`
   - root exports in `src/index.ts`
   - JSX runtime exports
3. rerun the full suite:
   ```sh
   bun test
   ```

## Registry smoke test fails

Symptoms:
- `bun run test:smoke:registry` fails
- release workflow cannot install the published package
- npm version not found / delayed availability

Common causes:
- package version was not published yet
- registry propagation delay after publish
- wrong `REGISTRY_SMOKE_SPEC`

What to check:
- published npm version matches release/tag expectations
- `REGISTRY_SMOKE_SPEC` points at the intended version
- retry/backoff may still be waiting on npm propagation

Useful paths:
- workflow: `.github/workflows/registry-smoke.yml`
- command:
  ```sh
  bun run test:smoke:registry
  ```

If the version is freshly published, retry after npm metadata catches up.

See also: [Maintainer release guide](./maintainer-release.md)

## `render()` output is not what you expected

Symptoms:
- missing tools/messages/system text
- prompt structure looks different from what JSX visually suggests

What to do:
- inspect the extracted prompt directly:

```ts
import { render } from "jsx-ai"
console.log(JSON.stringify(render(prompt), null, 2))
```

Checks:
- confirm `children` are actually nested where you think they are
- confirm `<message role="user">...</message>` is used, not plain text in the wrong place
- confirm tool params are nested under the intended `<tool>`
- confirm `<prompt>` options are on the wrapper you actually pass to `callLLM()`

See also: [Examples guide](./examples.md)

## Tool calls are missing from the response

Symptoms:
- `result.toolCalls` is empty
- model returned plain text instead of a structured/native tool call

What to check:
- chosen strategy
- chosen provider
- whether the prompt actually included tools
- whether the model/backend supports the expected tool-calling path

Debug workflow:
1. inspect the prompt with `render()`
2. compare behavior with another strategy
3. use the strategy examples as a baseline:
   - `examples/strategies.tsx`
   - `examples/natural-strategy.tsx`
4. inspect `result.request` from `callLLM()`

Notes:
- `native` and `hybrid` depend on provider-native tool calling
- `xml`, `natural`, and `nlt` rely on text formats that the strategy parser can recognize

## Streaming returns nothing or partial output

Symptoms:
- `streamLLM()` yields nothing
- output stops early
- local gateway works for chat completions but not streaming

What to check:
- backend actually supports SSE-compatible streaming
- correct base URL override is set
- provider/model pairing matches the expected streaming path

For local debugging, compare against the self-contained example:

```sh
bun run examples/stream-text.ts
```

## Skills do not resolve

Symptoms:
- requested skill never appears in resolved prompt
- `resolveSkills()` returns an empty array

What to check:
- skill markdown file exists and is readable
- frontmatter `name` matches what the model requested
- requested skill name is close enough for case-insensitive substring matching

Useful debugging steps:
- inspect parsed metadata with `parseSkillFile()`
- verify discovery mode output from `<Skill path="..." />`
- compare with the runnable skills example:
  ```sh
  bun run examples/skills.tsx
  ```

## Hooks or explorer telemetry are not showing up

Symptoms:
- custom hook appears not to fire
- explorer backend receives nothing

What to check:
- `registerHook()` was called before the LLM invocation
- `JSX_AI_EXPLORER_URL` is set in the current process
- the explorer endpoint accepts POSTs at `/api/prompts`

Notes:
- hook errors are swallowed so they do not break LLM calls
- explorer POST failures are ignored by design

## Need the fastest debug path

Use this order:

1. inspect prompt with `render()`
2. run the focused example closest to your issue
3. run targeted tests:
   ```sh
   bun run test:unit
   bun run test:smoke
   ```
4. run full suite:
   ```sh
   bun test
   ```
5. for published-package issues, use:
   ```sh
   bun run test:smoke:registry
   ```

## Related guides

- [Configuration & compatibility guide](./configuration.md)
- [Examples guide](./examples.md)
- [Contributor CI & test guide](./contributor-ci.md)
- [Maintainer release guide](./maintainer-release.md)
- [API reference](./api-reference.md)
