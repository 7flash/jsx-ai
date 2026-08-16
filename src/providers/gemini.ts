import {
  array,
  jsonObject,
  jsonValue,
  number,
  record,
  string,
} from "../internal/json";
import { jsonSchemaToJson, normalizePreparedPrompt } from "../ir";
import type {
  ExtractedMessage,
  JsonObject,
  PreparedPrompt,
  ProviderResponse,
  ToolCall,
} from "../types";
import type { Provider, ProviderRequest } from "./provider";

interface GeminiContent {
  role: string;
  parts: JsonObject[];
}

export class GeminiProvider implements Provider {
  readonly name = "gemini";

  buildRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: this.toBody(prepared),
    };
  }

  buildStreamRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: this.toBody(prepared),
    };
  }

  parseStreamEvent(data: unknown): string {
    const root = record(data);
    const candidate = record(array(root?.candidates)[0]);
    const content = record(candidate?.content);
    return array(content?.parts)
      .map((part) => string(record(part)?.text) ?? "")
      .join("");
  }

  parseResponse(data: unknown): ProviderResponse {
    const root = record(data);
    const candidate = record(array(root?.candidates)[0]);
    const content = record(candidate?.content);
    const parts = array(content?.parts);
    const nativeToolCalls: ToolCall[] = [];
    let text = "";

    for (let index = 0; index < parts.length; index++) {
      const part = record(parts[index]);
      if (!part) continue;
      text += string(part.text) ?? "";
      const functionCall = record(part.functionCall);
      if (!functionCall) continue;
      const name = string(functionCall.name);
      if (!name)
        throw new Error("Gemini returned a functionCall without a name");
      const id = string(functionCall.id);
      const thoughtSignature = string(part.thoughtSignature);
      nativeToolCalls.push({
        ...(id ? { id } : { id: `gemini_${index}_${name}` }),
        name,
        args: jsonObject(
          functionCall.args ?? {},
          `Gemini tool call ${name} args`,
        ),
        ...(thoughtSignature
          ? { providerMetadata: { gemini: { thoughtSignature } } }
          : {}),
      });
    }

    const usage = record(root?.usageMetadata);
    return {
      text,
      nativeToolCalls,
      raw: data,
      finishReason: string(candidate?.finishReason),
      usage: usage
        ? {
            inputTokens: number(usage.promptTokenCount) ?? 0,
            outputTokens: number(usage.candidatesTokenCount) ?? 0,
            thinkingTokens: number(usage.thoughtsTokenCount) ?? 0,
          }
        : undefined,
    };
  }

  private resultPayload(content: string): JsonObject {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { result: content };
    }
    const value = jsonValue(parsed, "Gemini tool result");
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value
      : { result: value };
  }

  private messageParts(message: ExtractedMessage): GeminiContent {
    if (message.role === "tool") {
      if (!message.toolName)
        throw new Error("Gemini tool-result messages require toolName");
      return {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: message.toolCallId,
              name: message.toolName,
              response: this.resultPayload(message.content),
            },
          },
        ],
      };
    }

    const parts: JsonObject[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      const geminiMetadata = call.providerMetadata?.gemini;
      const thoughtSignature =
        geminiMetadata && typeof geminiMetadata.thoughtSignature === "string"
          ? geminiMetadata.thoughtSignature
          : undefined;
      parts.push({
        functionCall: { id: call.id, name: call.name, args: call.args },
        ...(thoughtSignature ? { thoughtSignature } : {}),
      });
    }
    if (parts.length === 0) parts.push({ text: "" });
    return { role: message.role === "assistant" ? "model" : "user", parts };
  }

  private toBody(prepared: PreparedPrompt): JsonObject {
    prepared = normalizePreparedPrompt(prepared);
    // Gemini rejects consecutive same-role messages. Merge while preserving structured parts.
    const contents: GeminiContent[] = [];
    for (const message of prepared.messages) {
      const serialized = this.messageParts(message);
      const last = contents[contents.length - 1];
      if (last?.role === serialized.role) last.parts.push(...serialized.parts);
      else contents.push(serialized);
    }

    const body: JsonObject = {
      contents: contents.map((content) => ({
        role: content.role,
        parts: content.parts,
      })),
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
          functionDeclarations: prepared.nativeTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: jsonSchemaToJson(tool.parameters),
          })),
        },
      ];
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }
    return body;
  }
}
