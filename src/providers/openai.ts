import type {
  ExtractedMessage,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider } from "./provider";

export class OpenAIProvider implements Provider {
  name = "openai";

  buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
    return {
      url: this.baseUrl(model),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: this.toBody(prepared, model),
    };
  }

  buildStreamRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
    const request = this.buildRequest(prepared, model, apiKey);
    request.body = { ...request.body, stream: true };
    return request;
  }

  parseStreamEvent(data: any): string {
    return data.choices?.[0]?.delta?.content || "";
  }

  parseResponse(data: any): ProviderResponse {
    const choice = data.choices?.[0];
    const message = choice?.message || {};
    const nativeToolCalls: ToolCall[] = [];

    for (const tc of message.tool_calls || []) {
      if (tc.type !== "function") continue;
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      nativeToolCalls.push({ id: tc.id, name: tc.function.name, args });
    }

    const usage = data.usage;
    return {
      text: message.content || "",
      nativeToolCalls,
      raw: data,
      finishReason: choice?.finish_reason,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
          }
        : undefined,
    };
  }

  private baseUrl(model: string): string {
    let base: string;
    if (model.startsWith("deepseek")) {
      base = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    } else if (model.startsWith("qwen")) {
      base =
        process.env.DASHSCOPE_BASE_URL ||
        process.env.OPENAI_API_URL ||
        "https://coding-intl.dashscope.aliyuncs.com/v1";
    } else {
      base =
        process.env.OPENAI_API_URL ||
        process.env.OPENAI_BASE_URL ||
        "https://api.openai.com/v1";
    }
    return `${base.replace(/\/$/, "")}/chat/completions`;
  }

  private serializeMessage(message: ExtractedMessage): any {
    if (message.role === "tool") {
      if (!message.toolCallId) {
        throw new Error("OpenAI tool-result messages require toolCallId");
      }
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call, index) => ({
          id: call.id || `call_${index}_${call.name}`,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args || {}),
          },
        })),
      };
    }

    return { role: message.role, content: message.content };
  }

  private toBody(prepared: PreparedPrompt, model: string): any {
    const messages: any[] = [];
    if (prepared.system)
      messages.push({ role: "system", content: prepared.system });
    for (const m of prepared.messages) messages.push(this.serializeMessage(m));

    const isReasoning = /^o[0-9]/.test(model);
    const body: any = {
      model,
      messages,
      ...(isReasoning ? {} : { temperature: prepared.temperature ?? 0.1 }),
      ...(isReasoning
        ? { max_completion_tokens: prepared.maxTokens ?? 4000 }
        : { max_tokens: prepared.maxTokens ?? 4000 }),
    };

    if (prepared.nativeTools?.length) {
      body.tools = prepared.nativeTools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = "auto";
    }
    return body;
  }
}
