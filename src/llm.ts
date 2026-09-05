// ── jsx-ai LLM runtime ──
// JSX → canonical IR → strategy lowering → provider backend → normalized response.

import { JsxAiError } from "./errors";
import { errorMessage } from "./internal/errors";
import {
  AGENT_RUNTIME_CONTEXT,
  type AgentRuntimeCarrier,
} from "./internal/agent-runtime";
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
import { normalizePreparedPrompt, normalizePromptIR } from "./ir";
import {
  resolveRuntimeConfig,
  type RuntimeName,
} from "./internal/runtime-config";
import {
  callCodexRuntime,
  callCodexTextRuntime,
  streamCodexTextRuntime,
  type CodexRuntimeOptions,
} from "./runtimes/codex";

export type { LLMResponse, RequestOptions, CodexRuntimeOptions };
export { listProviders, listStrategies, registerProvider, registerStrategy };

export type LLMRuntime = RuntimeName;

export interface CallOptions extends RequestOptions {
  provider?: ProviderName;
  /** Execution backend. Defaults to JSX_AI_RUNTIME, then "api". */
  runtime?: LLMRuntime;
  /** Options for runtime="codex". */
  codex?: CodexRuntimeOptions;
  strategy?: StrategyName;
  /** Model override. Defaults to JSX_AI_MODEL, then prompt/runtime defaults. */
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
  runtime?: LLMRuntime;
  /** Optional model override for the messages-first callText/streamLLM overloads. */
  model?: string;
  codex?: CodexRuntimeOptions;
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
  runtime?: LLMRuntime;
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

function fireHooks(event: PromptEvent): void {
  // Telemetry is deliberately isolated from the caller. Hook/sink failures never
  // affect model execution and the core library never writes unsolicited logs.
  for (const hook of [...hooks]) {
    try {
      void Promise.resolve(hook(event)).catch(() => {});
    } catch {
      // A telemetry observer must not change call semantics.
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
  }).catch(() => {});
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
  modelOverride?: string,
): ExtractedPrompt {
  return normalizePromptIR({
    ...prompt,
    ...(modelOverride !== undefined ? { model: modelOverride } : {}),
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {}),
  });
}

function assertCodexProvider(
  model: string | undefined,
  override?: ProviderName,
): void {
  if (override !== undefined && override !== "openai") {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `runtime="codex" requires provider="openai" when provider is explicit; received ${JSON.stringify(override)}`,
    );
  }
  if (!model) return;
  const provider = resolveProvider(model, override);
  if (provider.name !== "openai") {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `runtime="codex" requires an OpenAI/Codex model when model is explicit; ${JSON.stringify(model)} resolved to ${provider.name}`,
    );
  }
}

function codexRuntimeOptions(options?: CallOptions | TextCallOptions) {
  return {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options?.codex ? { codex: options.codex } : {}),
  };
}

function resolveCall(
  prompt: ExtractedPrompt,
  model: string,
  options?: CallOptions,
): ResolvedCall {
  const normalized = withCallOverrides(prompt, options, model);
  const strategy = resolveStrategy(normalized, options?.strategy);
  const provider = resolveProvider(
    model,
    options?.provider ?? normalized.providerOverride,
  );
  const apiKey = resolveApiKey(provider, model, options);
  const prepared = normalizePreparedPrompt(strategy.prepare(normalized));
  return {
    prompt: normalized,
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
    prepared: normalizePreparedPrompt({
      system: system || undefined,
      messages: telemetryMessages,
      temperature,
      maxTokens,
    }),
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
  const extracted = extract(tree);
  const config = resolveRuntimeConfig(
    {
      ...(options?.runtime !== undefined ? { runtime: options.runtime } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
    },
    extracted.model,
  );

  if (config.runtime === "codex") {
    const prompt = withCallOverrides(extracted, options, config.model);
    const model = config.model;
    const modelLabel = model ?? "codex-config-default";
    assertCodexProvider(model, options?.provider ?? prompt.providerOverride);
    try {
      const runtimeContext = (
        options as (CallOptions & AgentRuntimeCarrier) | undefined
      )?.[AGENT_RUNTIME_CONTEXT];
      const result = await callCodexRuntime(
        prompt,
        model,
        codexRuntimeOptions(options),
        runtimeContext,
      );
      fireHooks({
        ...eventBase(
          startedAt,
          "callLLM",
          modelLabel,
          "openai",
          prompt.messages,
          prompt.system,
        ),
        runtime: "codex",
        strategy: prompt.tools.length ? "codex-native-tools" : "codex-text",
        tools: prompt.tools.map((tool) => tool.name),
        response: { text: result.text, toolCalls: result.toolCalls },
        usage: result.usage,
      });
      return result;
    } catch (error) {
      fireHooks({
        ...eventBase(
          startedAt,
          "callLLM",
          modelLabel,
          "openai",
          prompt.messages,
          prompt.system,
        ),
        runtime: "codex",
        strategy: prompt.tools.length ? "codex-native-tools" : "codex-text",
        tools: prompt.tools.map((tool) => tool.name),
        response: { text: "" },
        error: errorMessage(error),
      });
      throw error;
    }
  }

  const imageAttachmentCount = extracted.messages.reduce(
    (total, message) => total + (message.attachments?.length ?? 0),
    0,
  );
  if (imageAttachmentCount > 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `API runtime does not yet support canonical image attachments (${imageAttachmentCount} present). Use runtime="codex" for multimodal agent history.`,
    );
  }

  if (!config.model) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      'API runtime requires a model. Set JSX_AI_MODEL, <prompt model="...">, or callOptions.model.',
    );
  }
  const resolved = resolveCall(extracted, config.model, options);
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
      runtime: "api",
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
      runtime: "api",
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

interface ResolvedTextCallInput {
  model?: string;
  messages: readonly TextMessage[];
  options?: TextCallOptions;
}

function isTextMessages(value: unknown): value is readonly TextMessage[] {
  return Array.isArray(value);
}

function resolveTextCallInput(
  modelOrMessages: string | readonly TextMessage[],
  messagesOrOptions?: readonly TextMessage[] | TextCallOptions,
  maybeOptions?: TextCallOptions,
): ResolvedTextCallInput {
  if (typeof modelOrMessages === "string") {
    if (!isTextMessages(messagesOrOptions)) {
      throw new JsxAiError(
        "INVALID_ARGUMENT",
        "callText/streamLLM requires a messages array after the positional model",
      );
    }
    return {
      model: modelOrMessages,
      messages: messagesOrOptions,
      ...(maybeOptions ? { options: maybeOptions } : {}),
    };
  }

  const options = isTextMessages(messagesOrOptions)
    ? undefined
    : messagesOrOptions;
  return {
    messages: modelOrMessages,
    ...(options?.model ? { model: options.model } : {}),
    ...(options ? { options } : {}),
  };
}

function textPromptIR(
  messages: readonly TextMessage[],
  model: string | undefined,
  options?: TextCallOptions,
): {
  prompt: ExtractedPrompt;
  prepared: PreparedPrompt;
  telemetryMessages: ExtractedMessage[];
  system?: string;
} {
  const { prepared, telemetryMessages, system } = textPrepared(
    messages,
    options?.temperature ?? 0.3,
    options?.maxTokens ?? 8000,
  );
  const prompt = normalizePromptIR({
    tools: [],
    messages: telemetryMessages,
    ...(system ? { system } : {}),
    ...(model ? { model } : {}),
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {}),
  });
  return {
    prompt,
    prepared,
    telemetryMessages,
    ...(system ? { system } : {}),
  };
}

export function callText(
  model: string,
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): Promise<string>;
export function callText(
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): Promise<string>;
export async function callText(
  modelOrMessages: string | readonly TextMessage[],
  messagesOrOptions?: readonly TextMessage[] | TextCallOptions,
  maybeOptions?: TextCallOptions,
): Promise<string> {
  const startedAt = Date.now();
  const input = resolveTextCallInput(
    modelOrMessages,
    messagesOrOptions,
    maybeOptions,
  );
  const options = input.options;
  const config = resolveRuntimeConfig({
    ...(options?.runtime !== undefined ? { runtime: options.runtime } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  });
  const model = config.model;
  const modelLabel = model ?? "codex-config-default";
  const { prompt, prepared, telemetryMessages, system } = textPromptIR(
    input.messages,
    model,
    options,
  );

  if (config.runtime === "codex") {
    assertCodexProvider(model, options?.provider);
    try {
      const result = await callCodexTextRuntime(
        prompt,
        model,
        codexRuntimeOptions(options),
      );
      fireHooks({
        ...eventBase(
          startedAt,
          "callText",
          modelLabel,
          "openai",
          telemetryMessages,
          system,
        ),
        runtime: "codex",
        response: { text: result.text },
        usage: result.usage,
      });
      return result.text;
    } catch (error) {
      fireHooks({
        ...eventBase(
          startedAt,
          "callText",
          modelLabel,
          "openai",
          telemetryMessages,
          system,
        ),
        runtime: "codex",
        response: { text: "" },
        error: errorMessage(error),
      });
      throw error;
    }
  }

  if (!model) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      "API runtime requires a model. Set JSX_AI_MODEL, TextCallOptions.model, or use the positional model argument.",
    );
  }
  const provider = resolveProvider(model, options?.provider);
  const apiKey = resolveApiKey(provider, model, options);
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
      runtime: "api",
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
      runtime: "api",
      response: { text: "" },
      error: errorMessage(error),
    });
    throw error;
  }
}

export function streamLLM(
  model: string,
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): AsyncGenerator<string>;
export function streamLLM(
  messages: readonly TextMessage[],
  options?: TextCallOptions,
): AsyncGenerator<string>;
export async function* streamLLM(
  modelOrMessages: string | readonly TextMessage[],
  messagesOrOptions?: readonly TextMessage[] | TextCallOptions,
  maybeOptions?: TextCallOptions,
): AsyncGenerator<string> {
  const startedAt = Date.now();
  const input = resolveTextCallInput(
    modelOrMessages,
    messagesOrOptions,
    maybeOptions,
  );
  const options = input.options;
  const config = resolveRuntimeConfig({
    ...(options?.runtime !== undefined ? { runtime: options.runtime } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  });
  const model = config.model;
  const modelLabel = model ?? "codex-config-default";
  const { prompt, prepared, telemetryMessages, system } = textPromptIR(
    input.messages,
    model,
    options,
  );
  let text = "";

  if (config.runtime === "codex") {
    assertCodexProvider(model, options?.provider);
    try {
      for await (const chunk of streamCodexTextRuntime(
        prompt,
        model,
        codexRuntimeOptions(options),
      )) {
        text += chunk;
        yield chunk;
      }
      fireHooks({
        ...eventBase(
          startedAt,
          "streamLLM",
          modelLabel,
          "openai",
          telemetryMessages,
          system,
        ),
        runtime: "codex",
        response: { text },
      });
      return;
    } catch (error) {
      fireHooks({
        ...eventBase(
          startedAt,
          "streamLLM",
          modelLabel,
          "openai",
          telemetryMessages,
          system,
        ),
        runtime: "codex",
        response: { text },
        error: errorMessage(error),
      });
      throw error;
    }
  }

  if (!model) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      "API runtime requires a model. Set JSX_AI_MODEL, TextCallOptions.model, or use the positional model argument.",
    );
  }
  const provider = resolveProvider(model, options?.provider);
  if (!provider.buildStreamRequest || !provider.parseStreamEvent) {
    throw new JsxAiError(
      "UNSUPPORTED_CAPABILITY",
      `Provider ${provider.name} does not implement streaming`,
    );
  }
  const apiKey = resolveApiKey(provider, model, options);
  const request = provider.buildStreamRequest(prepared, model, apiKey);

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
      runtime: "api",
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
      runtime: "api",
      response: { text },
      error: errorMessage(error),
    });
    throw error;
  }
}
