import type { PreparedPrompt, ProviderResponse } from "../types"

/**
 * Provider interface — converts PreparedPrompt ↔ API format.
 *
 * Strategies produce PreparedPrompts (provider-agnostic).
 * Providers convert those into API-specific requests and parse responses.
 */
export interface Provider {
    name: string
    /** Build the full request config: URL, headers, body */
    buildRequest(prepared: PreparedPrompt, model: string, apiKey: string): {
        url: string
        headers: Record<string, string>
        body: any
    }
    /** Normalize the raw API response into a ProviderResponse */
    parseResponse(data: any): ProviderResponse
}
