import type { PreparedPrompt, ProviderResponse } from "../types";

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/** Provider backend: canonical prepared prompt ↔ provider wire protocol. */
export interface Provider {
  name: string;
  buildRequest(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest;
  parseResponse(data: any): ProviderResponse;
  /** Optional streaming wire protocol. streamLLM throws if a custom provider omits these. */
  buildStreamRequest?(
    prepared: PreparedPrompt,
    model: string,
    apiKey: string,
  ): ProviderRequest;
  parseStreamEvent?(data: any): string;
}
