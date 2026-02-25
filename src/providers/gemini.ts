import type { PreparedPrompt, ProviderResponse, ToolCall } from "../types"
import type { Provider } from "./provider"

export class GeminiProvider implements Provider {
    name = "gemini"

    buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
        return {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: this.toBody(prepared),
        }
    }

    parseResponse(data: any): ProviderResponse {
        const parts = data.candidates?.[0]?.content?.parts || []
        let text = ""
        const nativeToolCalls: ToolCall[] = []

        for (const part of parts) {
            if (part.text) text += part.text
            if (part.functionCall) {
                nativeToolCalls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args || {},
                })
            }
        }

        const usage = data.usageMetadata
        return {
            text,
            nativeToolCalls,
            raw: data,
            usage: usage ? {
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                thinkingTokens: usage.thoughtsTokenCount || 0,
            } : undefined,
        }
    }

    private toBody(prepared: PreparedPrompt): any {
        // Gemini rejects consecutive same-role messages — merge them
        const contents: { role: string; parts: { text: string }[] }[] = []
        for (const m of prepared.messages) {
            const role = m.role === "assistant" ? "model" : "user"
            const last = contents[contents.length - 1]
            if (last && last.role === role) {
                last.parts[0].text += "\n\n" + m.content
            } else {
                contents.push({ role, parts: [{ text: m.content }] })
            }
        }

        const body: any = {
            contents,
            generationConfig: {
                temperature: prepared.temperature ?? 0.1,
                maxOutputTokens: prepared.maxTokens ?? 4000,
            },
        }

        if (prepared.system) {
            body.systemInstruction = { parts: [{ text: prepared.system }] }
        }

        if (prepared.nativeTools && prepared.nativeTools.length > 0) {
            body.tools = [{
                functionDeclarations: prepared.nativeTools.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                })),
            }]
            body.toolConfig = { functionCallingConfig: { mode: "AUTO" } }
        }

        return body
    }
}
