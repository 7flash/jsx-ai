import type {
  ExtractedMessage,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider } from "./provider";

export class AnthropicProvider implements Provider {
  name = "anthropic";

  buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
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

  buildStreamRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
    const request = this.buildRequest(prepared, model, apiKey);
    request.body = { ...request.body, stream: true };
    return request;
  }

  parseStreamEvent(data: any): string {
    return data.type === "content_block_delta" &&
      data.delta?.type === "text_delta"
      ? data.delta.text || ""
      : "";
  }

  parseResponse(data: any): ProviderResponse {
    const nativeToolCalls: ToolCall[] = [];
    let text = "";
    for (const block of data.content || []) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        nativeToolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input || {},
        });
      }
    }

    const usage = data.usage;
    return {
      text,
      nativeToolCalls,
      raw: data,
      finishReason: data.stop_reason,
      usage: usage
        ? {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
          }
        : undefined,
    };
  }

  private serializeMessage(
    message: ExtractedMessage,
    index: number,
  ): { role: "user" | "assistant"; content: any[] } {
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

    const content: any[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (let i = 0; i < (message.toolCalls?.length || 0); i++) {
      const call = message.toolCalls![i];
      content.push({
        type: "tool_use",
        id: call.id || `toolu_${index}_${i}_${call.name}`,
        name: call.name,
        input: call.args || {},
      });
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
    return { role: message.role, content };
  }

  private toBody(prepared: PreparedPrompt, model: string): any {
    // Anthropic requires alternating roles. Merge consecutive same-role messages,
    // including user tool_result blocks following ordinary user content.
    const messages: Array<{ role: "user" | "assistant"; content: any[] }> = [];
    for (let i = 0; i < prepared.messages.length; i++) {
      const serialized = this.serializeMessage(prepared.messages[i], i);
      const last = messages[messages.length - 1];
      if (last?.role === serialized.role)
        last.content.push(...serialized.content);
      else messages.push(serialized);
    }

    const body: any = {
      model,
      messages,
      max_tokens: prepared.maxTokens ?? 4000,
      temperature: prepared.temperature ?? 0.1,
    };
    if (prepared.system) body.system = prepared.system;
    if (prepared.nativeTools?.length) {
      body.tools = prepared.nativeTools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    return body;
  }
}
