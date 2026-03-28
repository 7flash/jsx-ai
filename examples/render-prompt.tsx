// ── jsx-ai example: render a prompt without calling an LLM ──
// Demonstrates how to inspect the extracted prompt structure.
//
// Usage: bun run examples/render-prompt.tsx

import { render } from "../src"

const prompt = (
    <prompt model="gemini-2.5-flash" temperature={0.2} strategy="xml">
        <system>You are a careful planning assistant.</system>
        <tool name="search" description="Search project files">
            <param name="query" type="string" required>Search query</param>
        </tool>
        <message role="user">Find all references to provider overrides.</message>
    </prompt>
)

const extracted = render(prompt)

console.log("── Extracted prompt ──")
console.log(JSON.stringify(extracted, null, 2))
