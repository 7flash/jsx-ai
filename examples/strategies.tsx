// ── jsx-ai example: strategy-specific behavior ──
// Demonstrates how built-in strategies transform the same prompt and parse responses.
//
// Usage: bun run examples/strategies.tsx

import { render, native, xml, nlt, hybrid } from "../src"
import type { ExtractedPrompt, ProviderResponse, RenderStrategy } from "../src"

const prompt = (
    <prompt model="gpt-4o">
        <system>You are a careful coding assistant.</system>
        <tool name="write_file" description="Write a file to disk">
            <param name="path" type="string" required>Path to write</param>
            <param name="content" type="string" required>Full file contents</param>
        </tool>
        <tool name="exec" description="Run a shell command">
            <param name="command" type="string" required>Command to execute</param>
        </tool>
        <message role="user">Create src/hello.ts and then run bun test.</message>
    </prompt>
)

const extracted = render(prompt)

function logStrategy(name: string, strategy: RenderStrategy, extracted: ExtractedPrompt, response: ProviderResponse) {
    console.log(`── ${name} strategy: prepared prompt ──`)
    console.log(JSON.stringify(strategy.prepare(extracted), null, 2))
    console.log(`── ${name} strategy: parsed response ──`)
    console.log(JSON.stringify(strategy.parseResponse(response), null, 2))
    console.log()
}

const nativeLikeResponse: ProviderResponse = {
    text: "I'll create the file and run tests.",
    nativeToolCalls: [
        { name: "write_file", args: { path: "src/hello.ts", content: 'export const hello = () => "hi"\n' } },
        { name: "exec", args: { command: "bun test" } },
    ],
    raw: {},
}

const xmlResponse: ProviderResponse = {
    text: `<response>
  <message>I will create the file and run tests.</message>
  <tool_calls>
    <call tool="write_file">
      <param name="path">src/hello.ts</param>
      <param name="content">export const hello = () =&gt; "hi"</param>
    </call>
    <call tool="exec">
      <param name="command">bun test</param>
    </call>
  </tool_calls>
</response>`,
    nativeToolCalls: [],
    raw: {},
}

const nltResponse: ProviderResponse = {
    text: `Thinking: I should create the requested file, then run the test command.

write_file – YES
path: src/hello.ts
content: export const hello = () => "hi"

exec – YES
command: bun test

Assessment finished.`,
    nativeToolCalls: [],
    raw: {},
}

console.log("── Extracted prompt ──")
console.log(JSON.stringify(extracted, null, 2))
console.log()

logStrategy("native", native, extracted, nativeLikeResponse)
logStrategy("xml", xml, extracted, xmlResponse)
logStrategy("nlt", nlt, extracted, nltResponse)
logStrategy("hybrid", hybrid, extracted, nativeLikeResponse)
