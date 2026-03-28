// ── jsx-ai example: provider-specific usage ──
// Demonstrates Gemini, OpenAI-compatible, and Anthropic calls with mocked fetch.
//
// Usage: bun run examples/providers.tsx

import { callLLM } from "../src"

const originalFetch = globalThis.fetch

globalThis.fetch = async (url, init) => {
    const target = String(url)
    console.log("── Mock provider request ──")
    console.log(target)
    console.log(init?.body?.toString())

    if (target.includes("generativelanguage.googleapis.com")) {
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Gemini says hi." }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
        }), { status: 200, headers: { "Content-Type": "application/json" } })
    }

    if (target.includes("anthropic.com")) {
        return new Response(JSON.stringify({
            content: [{ type: "text", text: "Claude says hi." }],
            usage: { input_tokens: 11, output_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({
        choices: [{ message: { content: "OpenAI-compatible says hi." } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })
}

try {
    const gemini = await callLLM(
        <>
            <system>You are helpful.</system>
            <message role="user">Say hello from Gemini.</message>
        </>,
        { model: "gemini-2.5-flash", apiKey: "demo-gemini-key" },
    )
    console.log("Gemini:", gemini.text)

    const openai = await callLLM(
        <>
            <system>You are helpful.</system>
            <message role="user">Say hello from OpenAI-compatible.</message>
        </>,
        { model: "gpt-4o", apiKey: "demo-openai-key" },
    )
    console.log("OpenAI-compatible:", openai.text)

    const anthropic = await callLLM(
        <>
            <system>You are helpful.</system>
            <message role="user">Say hello from Anthropic.</message>
        </>,
        { model: "claude-3-sonnet-20240229", apiKey: "demo-anthropic-key" },
    )
    console.log("Anthropic:", anthropic.text)

    const providerOverride = await callLLM(
        <prompt model="custom-openai-route" provider="openai">
            <message role="user">Force provider override.</message>
        </prompt>,
        { apiKey: "demo-override-key" },
    )
    console.log("Provider override:", providerOverride.text)
} finally {
    globalThis.fetch = originalFetch
}
