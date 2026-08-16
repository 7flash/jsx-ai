import { array, jsonObject, number, record, string } from "../internal/json";
import { jsonSchemaToJson, normalizePreparedPrompt } from "../ir";
import type {
  ExtractedMessage,
  JsonObject,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider, ProviderRequest } from "./provider";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: JsonObject[];
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";

  buildRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
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
    const root = record(data);
    if (string(root?.type) !== "content_block_delta") return "";
    const delta = record(root?.delta);
    return string(delta?.type) === "text_delta"
      ? (string(delta?.text) ?? "")
      : "";
  }

  parseResponse(data: unknown): ProviderResponse {
    const root = record(data);
    const nativeToolCalls: ToolCall[] = [];
    let text = "";

    for (const rawBlock of array(root?.content)) {
      const block = record(rawBlock);
      const type = string(block?.type);
      if (type === "text") {
        text += string(block?.text) ?? "";
        continue;
      }
      if (type !== "tool_use") continue;
      const name = string(block?.name);
      if (!name)
        throw new Error("Anthropic returned a tool_use block without a name");
      nativeToolCalls.push({
        ...(string(block?.id) ? { id: string(block?.id) } : {}),
        name,
        args: jsonObject(
          block?.input ?? {},
          `Anthropic tool call ${name} input`,
        ),
      });
    }

    const usage = record(root?.usage);
    return {
      text,
      nativeToolCalls,
      raw: data,
      finishReason: string(root?.stop_reason),
      usage: usage
        ? {
            inputTokens: number(usage.input_tokens) ?? 0,
            outputTokens: number(usage.output_tokens) ?? 0,
          }
        : undefined,
    };
  }

  private serializeMessage(
    message: ExtractedMessage,
    index: number,
  ): AnthropicMessage {
    if (message.role === "tool") {
      if (!message.toolCallId)
        throw new Error("Anthropic tool-result messages require toolCallId");
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
            ...(message.isError ? { is_error: true } : {}),
          },
        ],
      };
    }

    const content: JsonObject[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (
      let callIndex = 0;
      callIndex < (message.toolCalls?.length ?? 0);
      callIndex++
    ) {
      const call = message.toolCalls?.[callIndex];
      if (!call) continue;
      content.push({
        type: "tool_use",
        id: call.id || `toolu_${index}_${callIndex}_${call.name}`,
        name: call.name,
        input: call.args,
      });
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
    return { role: message.role, content };
  }

  private toBody(prepared: PreparedPrompt, model: string): JsonObject {
    prepared = normalizePreparedPrompt(prepared);
    // Anthropic requires alternating roles. Merge consecutive same-role messages,
    // including user tool_result blocks following ordinary user content.
    const messages: AnthropicMessage[] = [];
    for (let index = 0; index < prepared.messages.length; index++) {
      const serialized = this.serializeMessage(prepared.messages[index], index);
      const last = messages[messages.length - 1];
      if (last?.role === serialized.role)
        last.content.push(...serialized.content);
      else messages.push(serialized);
    }

    const body: JsonObject = {
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_tokens: prepared.maxTokens ?? 4000,
      temperature: prepared.temperature ?? 0.1,
    };
    if (prepared.system) body.system = prepared.system;
    if (prepared.nativeTools?.length) {
      body.tools = prepared.nativeTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: jsonSchemaToJson(tool.parameters),
      }));
    }
    return body;
  }
}
