// ── jsx-ai example: custom provider, strategy, and hook ──
// Demonstrates the main extension points without hitting a real external API.
//
// Usage: bun run examples/customizations.tsx

import {
    callLLM,
    registerProvider,
    registerStrategy,
    registerHook,
    type Provider,
    type RenderStrategy,
} from "../src"

const customProvider: Provider = {
    name: "custom",
    buildRequest(prepared, model, apiKey) {
        return {
            url: "https://example.invalid/custom-llm",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: {
                model,
                system: prepared.system,
                messages: prepared.messages,
                note: "custom provider example",
            },
        }
    },
    parseResponse(data) {
        return {
            text: data.text || "",
            nativeToolCalls: data.nativeToolCalls || [],
            raw: data,
        }
    },
}

const customStrategy: RenderStrategy = {
    name: "custom-strategy",
    prepare(prompt) {
        return {
            system: `[custom-strategy]\n${prompt.system || ""}`,
            messages: prompt.messages
                .filter(m => m.role === "user" || m.role === "assistant")
                .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
        }
    },
    parseResponse(response) {
        return {
            text: response.text,
            toolCalls: response.nativeToolCalls,
        }
    },
}

registerProvider("custom", customProvider)
registerStrategy("custom-strategy", customStrategy)
registerHook((event) => {
    console.log(`[hook] ${event.method} via ${event.provider}/${event.strategy} in ${event.durationMs}ms`)
})

const originalFetch = globalThis.fetch

globalThis.fetch = async (url, init) => {
    console.log("── Mock fetch request ──")
    console.log(String(url))
    console.log(init?.body?.toString())

    return new Response(JSON.stringify({
        text: "Hello from the custom provider.",
        nativeToolCalls: [],
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

try {
    const result = await callLLM(
        <prompt model="custom-model" provider="custom" strategy="custom-strategy">
            <system>You are running through the custom extension path.</system>
            <message role="user">Say hello.</message>
        </prompt>,
        { apiKey: "demo-key" },
    )

    console.log("── Result ──")
    console.log(result.text)
} finally {
    globalThis.fetch = originalFetch
}
