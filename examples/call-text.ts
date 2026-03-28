// ── jsx-ai example: callText without JSX ──
// Demonstrates the lightweight text-in/text-out API using a mocked fetch.
//
// Usage: bun run examples/call-text.ts

import { callText } from "../src"

const originalFetch = globalThis.fetch

globalThis.fetch = async (url, init) => {
    console.log("── Mock text request ──")
    console.log(String(url))
    console.log(init?.body?.toString())

    return new Response(JSON.stringify({
        choices: [{ message: { content: "1. Set up routes\n2. Add auth\n3. Write tests" } }],
        usage: { prompt_tokens: 12, completion_tokens: 9 },
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

try {
    const text = await callText("gpt-4o", [
        { role: "system", content: "You are a planner." },
        { role: "user", content: "Break building an authenticated API into steps." },
    ], {
        apiKey: "demo-key",
    })

    console.log("── callText result ──")
    console.log(text)
} finally {
    globalThis.fetch = originalFetch
}
