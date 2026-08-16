// ── jsx-ai LLM runtime ──
// JSX → canonical IR → strategy lowering → provider backend → normalized response.

import { JsxAiError } from "./errors";
import { errorMessage } from "./internal/errors";
import { resolveApiKey } from "./internal/auth";
import {
  listProviders,
  listStrategies,
  registerProvider,
  registerStrategy,
  resolveProvider,
  resolveStrategy,
} from "./internal/registry";
import {
  parseSSEStream,
  requestJson,
  requestStream,
  type RequestOptions,
} from "./internal/transport";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsxAiNode,
  LLMResponse,
  PreparedPrompt,
  ProviderName,
  RenderStrategy,
  StrategyName,
  ToolCall,
} from "./types";
import type { Provider, ProviderRequest } from "./providers/provider";
import { extract } from "./render";

export type { LLMResponse, RequestOptions };
export { listProviders, listStrategies, registerProvider, registerStrategy };

export interface CallOptions extends RequestOptions {
  provider?: ProviderName;
  strategy?: StrategyName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextCallOptions extends RequestOptions {
  provider?: ProviderName;
  temperature?: number;
  maxTokens?: number;
}

// ── Hooks / telemetry ──

export interface PromptEvent {
  id: string;
  timestamp: number;
  method: "callLLM" | "callText" | "streamLLM";
  model: string;
  provider: string;
  strategy?: string;
  messages: readonly ExtractedMessage[];
  system?: string;
  tools?: readonly string[];
  response: { text: string; toolCalls?: readonly ToolCall[] };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
  durationMs: number;
  error?: string;
}

export type PromptHook = (event: PromptEvent) => void | Promise<void>;

const HOOKS_KEY = Symbol.for("jsx-ai.prompt-hooks");
const hookState = globalThis as typeof globalThis & {
  [HOOKS_KEY]?: PromptHook[];
};
const hooks = hookState[HOOKS_KEY] ?? (hookState[HOOKS_KEY] = []);

export function registerHook(hook: PromptHook): () => void {
  hooks.push(hook);
  return () => {
    const index = hooks.indexOf(hook);
    if (index >= 0) hooks.splice(index, 1);
  };
}

let hookIdCounter = 0;
function generateId(): string {
  return `${Date.now()}-${++hookIdCounter}`;
}

function reportTelemetryError(error: unknown): void {
  if (process.env.JSX_AI_DEBUG_TELEMETRY === "1") {
    console.warn(`[jsx-ai] telemetry sink failed: ${errorMessage(error)}`);
  }
}

function fireHooks(event: PromptEvent): void {
  for (const hook of [...hooks]) {
    try {
      void Promise.resolve(hook(event)).catch(reportTelemetryError);
    } catch (error) {
      reportTelemetryError(error);
    }
  }

  // Explorer telemetry is an environment-level sink, not a self-registering hook.
  // This avoids duplicate posts when the package is resolved through two module paths.
  const url = process.env.JSX_AI_EXPLORER_URL;
  if (!url) return;
  void fetch(`${url.replace(/\/$/, "")}/api/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(reportTelemetryError);
}

// ── Call preparation ──

interface ResolvedCall {
  prompt: ExtractedPrompt;
  strategy: RenderStrategy;
  provider: Provider;
  model: string;
  prepared: PreparedPrompt;
  request: ProviderRequest;
}

function withCallOverrides(
  prompt: ExtractedPrompt,
  options?: CallOptions,
): ExtractedPrompt {
  return {
    ...prompt,
    ...(options?.model !== undefined ? { model: options.model } : {}),
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {}),
  };
}

function resolveCall(tree: JsxAiNode, options?: CallOptions): ResolvedCall {
  const prompt = withCallOverrides(extract(tree), options);
  const strategy = resolveStrategy(prompt, options?.strategy);
  const model = prompt.model || "gemini-2.5-flash";
  const provider = resolveProvider(
    model,
    options?.provider ?? prompt.providerOverride,
  );
  const apiKey = resolveApiKey(provider, options);
  const prepared = strategy.prepare(prompt);
  return {
    prompt,
    strategy,
    provider,
    model,
    prepared,
    request: provider.buildRequest(prepared, model, apiKey),
  };
}

function requestInit(request: ProviderRequest): RequestInit {
  return {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  };
}

function textPrepared(
  messages: readonly TextMessage[],
  temperature: number,
  maxTokens: number,
): {
  prepared: PreparedPrompt;
  telemetryMessages: ExtractedMessage[];
  system?: string;
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const telemetryMessages: ExtractedMessage[] = messages
    .filter(
      (message): message is TextMessage & { role: "user" | "assistant" } =>
        message.role !== "system",
    )
    .map((message) => ({ role: message.role, content: message.content }));

  return {
    prepared: {
      system: system || undefined,
      messages: telemetryMessages,
      temperature,
      maxTokens,
    },
    telemetryMessages,
    system: system || undefined,
  };
}

function eventBase(
  startedAt: number,
  method: PromptEvent["method"],
  model: string,
  provider: string,
  messages: readonly ExtractedMessage[],
  system?: string,
): Pick<
  PromptEvent,
  | "id"
  | "timestamp"
  | "method"
  | "model"
  | "provider"
  | "messages"
  | "system"
  | "durationMs"
> {
  return {
    id: generateId(),
    timestamp: startedAt,
    method,
    model,
    provider,
    messages,
    system,
    durationMs: Date.now() - startedAt,
  };
}

// ── Public API ──

export async function callLLM(
  tree: JsxAiNode,
  options?: CallOptions,
): Promise<LLMResponse> {
  const startedAt = Date.now();
  const resolved = resolveCall(tree, options);
  const { prompt, strategy, provider, model, prepared, request } = resolved;

  try {
    const data = await requestJson(
      request.url,
      requestInit(request),
      options,
      `${provider.name} ${model}`,
    );
    const providerResponse = provider.parseResponse(data);
    const { text, toolCalls } = strategy.parseResponse(
      providerResponse,
      prompt,
    );
    const result: LLMResponse = {
      text,
      toolCalls,
      raw: data,
      request: { url: request.url, body: request.body, prepared },
      finishReason: providerResponse.finishReason,
      usage: providerResponse.usage,
    };
    fireHooks({
      ...eventBase(
        startedAt,
        "callLLM",
        model,
        provider.name,
        prompt.messages,
        prompt.system,
      ),
      strategy: strategy.name,
      tools: prompt.tools.map((tool) => tool.name),
      response: { text, toolCalls },
      usage: providerResponse.usage,
    });
    return result;
  } catch (error) {
    fireHooks({
      ...eventBase(
        startedAt,
        "callLLM",
        model,
        provider.name,
        prompt.messages,
        prompt.system,
      ),
      strategy: strategy.name,
      tools: prompt.tools.map((tool) => tool.name),
      response: { text: "" },
      error: errorMessage(error),
    });
    throw error;
  }
}

export function render(tree: JsxAiNode): ExtractedPrompt {
  return extract(tree);
}

export async function callText(
  model: string,
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): Promise<string> {
  const startedAt = Date.now();
  const provider = resolveProvider(model, options?.provider);
  const apiKey = resolveApiKey(provider, options);
  const { prepared, telemetryMessages, system } = textPrepared(
    messages,
    options?.temperature ?? 0.3,
    options?.maxTokens ?? 8000,
  );
  const request = provider.buildRequest(prepared, model, apiKey);

  try {
    const data = await requestJson(
      request.url,
      requestInit(request),
      options,
      `${provider.name} ${model}`,
    );
    const parsed = provider.parseResponse(data);
    fireHooks({
      ...eventBase(
        startedAt,
        "callText",
        model,
        provider.name,
        telemetryMessages,
        system,
      ),
      response: { text: parsed.text },
      usage: parsed.usage,
    });
    return parsed.text;
  } catch (error) {
    fireHooks({
      ...eventBase(
        startedAt,
        "callText",
        model,
        provider.name,
        telemetryMessages,
        system,
      ),
      response: { text: "" },
      error: errorMessage(error),
    });
    throw error;
  }
}

export async function* streamLLM(
  model: string,
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): AsyncGenerator<string> {
  const startedAt = Date.now();
  const provider = resolveProvider(model, options?.provider);
  if (!provider.buildStreamRequest || !provider.parseStreamEvent) {
    throw new JsxAiError(
      "UNSUPPORTED_CAPABILITY",
      `Provider ${provider.name} does not implement streaming`,
    );
  }
  const apiKey = resolveApiKey(provider, options);
  const { prepared, telemetryMessages, system } = textPrepared(
    messages,
    options?.temperature ?? 0.3,
    options?.maxTokens ?? 8000,
  );
  const request = provider.buildStreamRequest(prepared, model, apiKey);
  let text = "";

  try {
    const response = await requestStream(
      request.url,
      requestInit(request),
      options,
      `${provider.name} ${model} stream`,
    );
    for await (const chunk of parseSSEStream(
      response,
      provider.parseStreamEvent.bind(provider),
    )) {
      text += chunk;
      yield chunk;
    }
    fireHooks({
      ...eventBase(
        startedAt,
        "streamLLM",
        model,
        provider.name,
        telemetryMessages,
        system,
      ),
      response: { text },
    });
  } catch (error) {
    fireHooks({
      ...eventBase(
        startedAt,
        "streamLLM",
        model,
        provider.name,
        telemetryMessages,
        system,
      ),
      response: { text },
      error: errorMessage(error),
    });
    throw error;
  }
}
