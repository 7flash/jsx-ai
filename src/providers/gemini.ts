import type {
  ExtractedMessage,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider } from "./provider";

export class GeminiProvider implements Provider {
  name = "gemini";

  buildRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: this.toBody(prepared),
    };
  }

  buildStreamRequest(prepared: PreparedPrompt, model: string, apiKey: string) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: this.toBody(prepared),
    };
  }

  parseStreamEvent(data: any): string {
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || "")
        .join("") || ""
    );
  }

  parseResponse(data: any): ProviderResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let text = "";
    const nativeToolCalls: ToolCall[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.text) text += part.text;
      if (part.functionCall) {
        nativeToolCalls.push({
          id: `gemini_${i}_${part.functionCall.name}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }

    const usage = data.usageMetadata;
    return {
      text,
      nativeToolCalls,
      raw: data,
      finishReason: candidate?.finishReason,
      usage: usage
        ? {
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: usage.candidatesTokenCount || 0,
            thinkingTokens: usage.thoughtsTokenCount || 0,
          }
        : undefined,
    };
  }

  private resultPayload(content: string): Record<string, any> {
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : { result: parsed };
    } catch {
      return { result: content };
    }
  }

  private messageParts(message: ExtractedMessage): {
    role: string;
    parts: any[];
  } {
    if (message.role === "tool") {
      if (!message.toolName)
        throw new Error("Gemini tool-result messages require toolName");
      return {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolName,
              response: this.resultPayload(message.content),
            },
          },
        ],
      };
    }

    const parts: any[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls || []) {
      parts.push({ functionCall: { name: call.name, args: call.args || {} } });
    }
    if (parts.length === 0) parts.push({ text: "" });
    return { role: message.role === "assistant" ? "model" : "user", parts };
  }

  private toBody(prepared: PreparedPrompt): any {
    // Gemini rejects consecutive same-role messages. Merge while preserving structured parts.
    const contents: { role: string; parts: any[] }[] = [];
    for (const message of prepared.messages) {
      const serialized = this.messageParts(message);
      const last = contents[contents.length - 1];
      if (last?.role === serialized.role) last.parts.push(...serialized.parts);
      else contents.push(serialized);
    }

    const body: any = {
      contents,
      generationConfig: {
        temperature: prepared.temperature ?? 0.1,
        maxOutputTokens: prepared.maxTokens ?? 4000,
      },
    };
    if (prepared.system)
      body.systemInstruction = { parts: [{ text: prepared.system }] };
    if (prepared.nativeTools?.length) {
      body.tools = [
        {
          functionDeclarations: prepared.nativeTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }
    return body;
  }
}
