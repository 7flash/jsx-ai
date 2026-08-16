import {
  array,
  number,
  parseJsonObject,
  record,
  string,
} from "../internal/json";
import type {
  ExtractedMessage,
  JsonObject,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider, ProviderRequest } from "./provider";

export class OpenAIProvider implements Provider {
  readonly name = "openai";

  buildRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest {
    return {
      url: this.baseUrl(model),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: this.toBody(prepared, model),
    };
  }

  buildStreamRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest {
    const request = this.buildRequest(prepared, model, apiKey);
    return { ...request, body: { ...request.body, stream: true } };
  }

  parseStreamEvent(data: unknown): string {
    const choice = record(array(record(data)?.choices)[0]);
    const delta = record(choice?.delta);
    return string(delta?.content) ?? "";
  }

  parseResponse(data: unknown): ProviderResponse {
    const root = record(data);
    const choice = record(array(root?.choices)[0]);
    const message = record(choice?.message);
    const nativeToolCalls: ToolCall[] = [];

    for (const rawCall of array(message?.tool_calls)) {
      const call = record(rawCall);
      if (string(call?.type) !== "function") continue;
      const fn = record(call?.function);
      const name = string(fn?.name);
      if (!name)
        throw new Error("OpenAI returned a function tool call without a name");
      const argumentText = string(fn?.arguments) ?? "{}";
      nativeToolCalls.push({
        ...(string(call?.id) ? { id: string(call?.id) } : {}),
        name,
        args: parseJsonObject(
          argumentText,
          `OpenAI tool call ${name} arguments`,
        ),
      });
    }

    const usage = record(root?.usage);
    return {
      text: string(message?.content) ?? "",
      nativeToolCalls,
      raw: data,
      finishReason: string(choice?.finish_reason),
      usage: usage
        ? {
            inputTokens: number(usage.prompt_tokens) ?? 0,
            outputTokens: number(usage.completion_tokens) ?? 0,
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

  private serializeMessage(message: ExtractedMessage): JsonObject {
    if (message.role === "tool") {
      if (!message.toolCallId)
        throw new Error("OpenAI tool-result messages require toolCallId");
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
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    }

    return { role: message.role, content: message.content };
  }

  private toBody(prepared: PreparedPrompt, model: string): JsonObject {
    const messages = prepared.messages.map((message) =>
      this.serializeMessage(message),
    );
    if (prepared.system)
      messages.unshift({ role: "system", content: prepared.system });

    const isReasoning = /^o[0-9]/.test(model);
    const body: JsonObject = {
      model,
      messages,
      ...(isReasoning ? {} : { temperature: prepared.temperature ?? 0.1 }),
      ...(isReasoning
        ? { max_completion_tokens: prepared.maxTokens ?? 4000 }
        : { max_tokens: prepared.maxTokens ?? 4000 }),
    };

    if (prepared.nativeTools?.length) {
      body.tools = prepared.nativeTools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = "auto";
    }
    return body;
  }
}
