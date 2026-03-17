import type { PreparedPrompt, ProviderResponse, ToolCall } from "../types"
import type { Provider } from "./provider"

export class OpenAIProvider implements Provider {
    name = "openai"

    buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
        // OpenAI-compatible APIs with different base URLs
        let baseUrl: string
        
        if (model.startsWith("deepseek")) {
            const base = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1"
            baseUrl = `${base.replace(/\/$/, '')}/chat/completions`
        } else if (model.startsWith("qwen")) {
            // Alibaba Cloud DashScope
            const base = process.env.DASHSCOPE_BASE_URL || process.env.OPENAI_API_URL || "https://coding-intl.dashscope.aliyuncs.com/v1"
            baseUrl = `${base.replace(/\/$/, '')}/chat/completions`
        } else {
            // Standard OpenAI or OpenAI-compatible (via OPENAI_API_URL)
            const base = process.env.OPENAI_API_URL || "https://api.openai.com/v1"
            baseUrl = `${base.replace(/\/$/, '')}/chat/completions`
        }

        return {
            url: baseUrl,
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

        // o4-* reasoning models use max_completion_tokens + fixed temperature
        const isReasoning = /^o[0-9]/.test(model)
        const body: any = {
            model,
            messages,
            temperature: isReasoning ? 1.0 : (prepared.temperature ?? 0.1),
            ...(isReasoning
                ? { max_completion_tokens: prepared.maxTokens ?? 4000 }
                : { max_tokens: prepared.maxTokens ?? 4000 }),
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
