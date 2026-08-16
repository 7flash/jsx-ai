import type {
  JsonObject,
  PreparedPrompt,
  ProviderName,
  ProviderResponse,
} from "../types";

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: JsonObject;
}

/** Provider backend: canonical prepared prompt ↔ provider wire protocol. */
export interface Provider {
  readonly name: ProviderName;
  buildRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest;
  parseResponse(data: unknown): ProviderResponse;
  /** Optional streaming wire protocol. streamLLM throws if a custom provider omits these. */
  buildStreamRequest?(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest;
  parseStreamEvent?(data: unknown): string;
}
