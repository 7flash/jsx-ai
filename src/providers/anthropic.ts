import type { PreparedPrompt, ProviderResponse, ToolCall } from "../types"
import type { Provider } from "./provider"

/**
 * Anthropic provider (Claude models).
 *
 * Nuances vs OpenAI:
 *   - Auth: x-api-key header + anthropic-version (not Bearer)
 *   - System prompt: top-level "system" field (not a message)
 *   - Response: content[].text (not choices[].message.content)
 *   - Tool calls: content[] blocks with type "tool_use" (not tool_calls[])
 *   - Tool args: already an object (not JSON string like OpenAI)
 */
export class AnthropicProvider implements Provider {
    name = "anthropic"

    buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
        return {
            url: "https://api.anthropic.com/v1/messages",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: this.toBody(prepared, model),
        }
    }

    parseResponse(data: any): ProviderResponse {
        const contentBlocks = data.content || []
        let text = ""
        const nativeToolCalls: ToolCall[] = []

        for (const block of contentBlocks) {
            if (block.type === "text") {
                text += block.text
            } else if (block.type === "tool_use") {
                nativeToolCalls.push({
                    name: block.name,
                    args: block.input || {},
                })
            }
        }

        const usage = data.usage
        return {
            text,
            nativeToolCalls,
            raw: data,
            usage: usage ? {
                inputTokens: usage.input_tokens || 0,
                outputTokens: usage.output_tokens || 0,
            } : undefined,
        }
    }

    private toBody(prepared: PreparedPrompt, model: string): any {
        const messages: any[] = []

        for (const m of prepared.messages) {
            messages.push({ role: m.role, content: m.content })
        }

        const body: any = {
            model,
            messages,
            max_tokens: prepared.maxTokens ?? 4000,
        }

        // System goes as top-level field, not as a message
        if (prepared.system) {
            body.system = prepared.system
        }

        if (prepared.nativeTools && prepared.nativeTools.length > 0) {
            body.tools = prepared.nativeTools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }))
        }

        return body
    }
}
