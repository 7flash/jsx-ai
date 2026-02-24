import type { PreparedPrompt, ProviderResponse, ToolCall } from "../types"
import type { Provider } from "./provider"

export class OpenAIProvider implements Provider {
    name = "openai"

    buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
        return {
            url: "https://api.openai.com/v1/chat/completions",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: this.toBody(prepared, model),
        }
    }

    parseResponse(data: any): ProviderResponse {
        const choice = data.choices?.[0]
        const message = choice?.message || {}
        const text = message.content || ""
        const nativeToolCalls: ToolCall[] = []

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                if (tc.type === "function") {
                    let args = {}
                    try { args = JSON.parse(tc.function.arguments || "{}") } catch { }
                    nativeToolCalls.push({
                        name: tc.function.name,
                        args,
                    })
                }
            }
        }

        const usage = data.usage
        return {
            text,
            nativeToolCalls,
            raw: data,
            usage: usage ? {
                inputTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
            } : undefined,
        }
    }

    private toBody(prepared: PreparedPrompt, model: string): any {
        const messages: any[] = []

        if (prepared.system) {
            messages.push({ role: "system", content: prepared.system })
        }

        for (const m of prepared.messages) {
            messages.push({ role: m.role, content: m.content })
        }

        const body: any = {
            model,
            messages,
            temperature: prepared.temperature ?? 0.1,
            max_tokens: prepared.maxTokens ?? 4000,
        }

        if (prepared.nativeTools && prepared.nativeTools.length > 0) {
            body.tools = prepared.nativeTools.map(t => ({
                type: "function",
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }))
            body.tool_choice = "auto"
        }

        return body
    }
}
