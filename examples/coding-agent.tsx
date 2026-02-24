// ── jsx-ai example: coding agent ──
// Demonstrates composable JSX components for LLM tool calling
//
// Usage: bun run examples/coding-agent.tsx

import { callLLM, render } from "../src"

// ── Reusable tool components ──

const ExecTool = () => (
    <tool name="exec" description="Execute a shell command and return stdout/stderr">
        <param name="command" type="string" required>The shell command to run</param>
    </tool>
)

const ReadFile = () => (
    <tool name="read_file" description="Read the contents of a file at the given path">
        <param name="path" type="string" required>Absolute or relative file path</param>
    </tool>
)

const WriteFile = () => (
    <tool name="write_file" description="Write content to a file, creating it if needed">
        <param name="path" type="string" required>File path to write</param>
        <param name="content" type="string" required>Content to write</param>
    </tool>
)

const EditFile = () => (
    <tool name="edit_file" description="Replace a specific string in a file">
        <param name="path" type="string" required>File path</param>
        <param name="search" type="string" required>Exact string to find</param>
        <param name="replace" type="string" required>Replacement string</param>
    </tool>
)

// ── Composable tool set ──

const CodingTools = () => (
    <>
        <ExecTool />
        <ReadFile />
        <WriteFile />
        <EditFile />
    </>
)

// ── Build the prompt ──

const userRequest = process.argv[2] || "Create a file called hello.ts that exports a greet function"

const prompt = (
    <prompt model="gemini-2.5-flash" temperature={0.1}>
        <system>
            You are an autonomous coding agent. Use the available tools to accomplish
            the user's request. Be precise with file paths and command syntax.
        </system>
        <CodingTools />
        <message role="user">{userRequest}</message>
    </prompt>
)

// ── Inspect what would be sent ──
console.log("── Extracted prompt structure ──")
const extracted = render(prompt)
console.log(`Model: ${extracted.model}`)
console.log(`System: ${extracted.system?.substring(0, 80)}...`)
console.log(`Tools: [${extracted.tools.map(t => t.name).join(", ")}]`)
console.log(`Messages: ${extracted.messages.length}`)
console.log()

// ── Call the LLM ──
console.log("── Calling LLM ──")
const result = await callLLM(prompt)

console.log(`\nResponse:`)
if (result.text) console.log(`  Text: ${result.text}`)
if (result.toolCalls.length > 0) {
    console.log(`  Tool calls:`)
    for (const tc of result.toolCalls) {
        console.log(`    ${tc.name}(${JSON.stringify(tc.args)})`)
    }
}
if (result.usage) {
    console.log(`  Tokens: ${result.usage.inputTokens} in → ${result.usage.outputTokens} out`)
}
