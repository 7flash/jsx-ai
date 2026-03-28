// ── jsx-ai example: natural strategy ──
// Demonstrates the plain-language TOOL_CALL protocol used by the natural strategy.
//
// Usage: bun run examples/natural-strategy.tsx

import { render, natural } from "../src"
import type { ExtractedPrompt, ProviderResponse } from "../src"

const prompt = (
    <prompt model="gpt-4o" strategy="natural">
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
const prepared = natural.prepare(extracted as ExtractedPrompt)

const response: ProviderResponse = {
    text: `THINKING: I should create the requested file first, then run the test command.

TOOL_CALL: write_file
PARAM path: src/hello.ts
PARAM content: export const hello = () => "hi"
END_CALL

TOOL_CALL: exec
PARAM command: bun test
END_CALL`,
    nativeToolCalls: [],
    raw: {},
}

console.log("── Extracted prompt ──")
console.log(JSON.stringify(extracted, null, 2))
console.log()

console.log("── natural strategy: prepared prompt ──")
console.log(JSON.stringify(prepared, null, 2))
console.log()

console.log("── natural strategy: parsed response ──")
console.log(JSON.stringify(natural.parseResponse(response), null, 2))
