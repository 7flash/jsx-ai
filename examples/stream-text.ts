// ── jsx-ai example: streamLLM token streaming ──
// Demonstrates streaming chunks from a local mock SSE server.
//
// Usage: bun run examples/stream-text.ts

import { streamLLM } from "../src"

const server = Bun.serve({
    port: 0,
    fetch() {
        const chunks = [
            `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n`,
            `data: {"choices":[{"delta":{"content":" from"}}]}\n\n`,
            `data: {"choices":[{"delta":{"content":" streamLLM"}}]}\n\n`,
            `data: [DONE]\n\n`,
        ]

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder()
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
                controller.close()
            },
        })

        return new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
        })
    },
})

const previousBase = process.env.OPENAI_BASE_URL
const previousKey = process.env.OPENAI_API_KEY
process.env.OPENAI_BASE_URL = `http://localhost:${server.port}`
process.env.OPENAI_API_KEY = "demo-key"

try {
    console.log("── streamLLM chunks ──")
    for await (const chunk of streamLLM("gpt-4o", [
        { role: "system", content: "You are cheerful." },
        { role: "user", content: "Say hello." },
    ])) {
        process.stdout.write(chunk)
    }
    process.stdout.write("\n")
} finally {
    server.stop(true)
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = previousBase
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousKey
}
