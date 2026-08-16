// ── jsx-ai LLM runtime ──
// JSX → canonical IR → strategy lowering → provider backend → normalized response.

import { readFileSync } from "fs";
import { resolve as resolvePath } from "path";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsxAiNode,
  LLMResponse,
  PreparedPrompt,
  ProviderName,
  RenderStrategy,
  StrategyName,
} from "./types";
import type { Provider } from "./providers/provider";
import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { extract } from "./render";
import { native } from "./strategies/native";
import { xml } from "./strategies/xml";
import { natural } from "./strategies/natural";
import { hybrid } from "./strategies/hybrid";
import { nlt } from "./strategies/nlt";

export type { LLMResponse };

export interface RequestOptions {
  apiKey?: string;
  /** Total request/body timeout per attempt. Default: 60 seconds. */
  timeoutMs?: number;
  /** Number of retries after the first attempt. Default: 3. */
  retries?: number;
  /** Optional external cancellation signal. */
  signal?: AbortSignal;
}

export interface CallOptions extends RequestOptions {
  provider?: ProviderName;
  strategy?: StrategyName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const STRATEGIES: Record<string, RenderStrategy> = {
  native,
  xml,
  natural,
  hybrid,
  nlt,
};
const PROVIDERS: Record<string, Provider> = {
  gemini: new GeminiProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
};

// ── Hooks / telemetry ──

export interface PromptEvent {
  id: string;
  timestamp: number;
  method: "callLLM" | "callText" | "streamLLM";
  model: string;
  provider: string;
  strategy?: string;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  tools?: string[];
  response: { text: string; toolCalls?: Array<{ name: string; args: any }> };
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
  for (const hook of [...hooks]) {
    try {
      Promise.resolve(hook(event)).catch(() => {});
    } catch {}
  }

  // Explorer telemetry is an environment-level sink, not a self-registering hook.
  // This avoids duplicate posts when the package is resolved through two module paths.
  const url = process.env.JSX_AI_EXPLORER_URL;
  if (url) {
    void fetch(`${url.replace(/\/$/, "")}/api/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  }
}

// ── Registration / resolution ──

export function registerProvider(name: string, provider: Provider): void {
  PROVIDERS[name] = provider;
}

export function registerStrategy(name: string, strategy: RenderStrategy): void {
  STRATEGIES[name] = strategy;
}

function resolveStrategy(
  prompt: ExtractedPrompt,
  override?: StrategyName,
): RenderStrategy {
  const choice = String(override || prompt.strategy || "auto");
  if (choice === "auto") return hybrid;
  const strategy = STRATEGIES[choice];
  if (!strategy)
    throw new Error(
      `Unknown strategy: ${choice}. Available: auto, ${Object.keys(STRATEGIES).join(", ")}`,
    );
  return strategy;
}

function detectProvider(model: string): string {
  if (/^(gpt-|o[0-9]|chatgpt)/i.test(model)) return "openai";
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(deepseek|qwen)/i.test(model)) return "openai";
  return "gemini";
}

function resolveProvider(model: string, override?: ProviderName): Provider {
  const name = String(override || detectProvider(model));
  const provider = PROVIDERS[name];
  if (!provider)
    throw new Error(
      `Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  return provider;
}

function configApiKey(providerName: string): string | undefined {
  try {
    const toml = readFileSync(
      resolvePath(process.cwd(), ".config.toml"),
      "utf-8",
    );
    let section = "";
    const acceptedSections = new Set([
      providerName.toLowerCase(),
      `provider.${providerName}`.toLowerCase(),
      `providers.${providerName}`.toLowerCase(),
    ]);
    for (const rawLine of toml.split(/\r?\n/)) {
      const line = rawLine.trim();
      const sectionMatch = line.match(/^\[([^\]]+)]$/);
      if (sectionMatch) {
        section = sectionMatch[1].trim().toLowerCase();
        continue;
      }
      if (!acceptedSections.has(section)) continue;
      const keyMatch = line.match(/^api_key\s*=\s*["']([^"']+)["']/);
      if (keyMatch) return keyMatch[1];
    }
  } catch {}
  return undefined;
}

function resolveApiKey(provider: Provider, options?: RequestOptions): string {
  if (options?.apiKey) return options.apiKey;

  const envCandidates =
    provider.name === "openai"
      ? [
          "OPENAI_API_KEY",
          "DEEPSEEK_API_KEY",
          "QWEN_API_KEY",
          "DASHSCOPE_API_KEY",
        ]
      : provider.name === "anthropic"
        ? ["ANTHROPIC_API_KEY"]
        : ["GEMINI_API_KEY", "GOOGLE_API_KEY"];

  for (const name of envCandidates) {
    const value = process.env[name];
    if (value) return value;
  }
  const config = configApiKey(provider.name);
  if (config) return config;
  throw new Error(
    `No API key found for ${provider.name}. Pass apiKey, set a provider-specific environment variable, or add [${provider.name}] api_key to .config.toml.`,
  );
}

// ── Public API ──

export async function callLLM(
  tree: JsxAiNode,
  options?: CallOptions,
): Promise<LLMResponse> {
  const t0 = Date.now();
  const prompt = extract(tree);
  if (options?.model) prompt.model = options.model;
  if (options?.temperature != null) prompt.temperature = options.temperature;
  if (options?.maxTokens != null) prompt.maxTokens = options.maxTokens;

  const strategy = resolveStrategy(prompt, options?.strategy);
  const model = prompt.model || "gemini-2.5-flash";
  const provider = resolveProvider(
    model,
    options?.provider || prompt.providerOverride,
  );
  const apiKey = resolveApiKey(provider, options);
  const prepared = strategy.prepare(prompt);
  const { url, headers, body } = provider.buildRequest(prepared, model, apiKey);

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      options,
    );
  } catch (error: any) {
    const message = error?.message || String(error);
    fireHooks({
      id: generateId(),
      timestamp: t0,
      method: "callLLM",
      model,
      provider: provider.name,
      strategy: strategy.name,
      messages: prompt.messages,
      system: prompt.system,
      tools: prompt.tools.map((t) => t.name),
      response: { text: "" },
      durationMs: Date.now() - t0,
      error: message,
    });
    throw error;
  }

  if (!res.ok) {
    const errText = await res.text();
    const error = `LLM API error ${res.status}: ${errText.substring(0, 500)}`;
    fireHooks({
      id: generateId(),
      timestamp: t0,
      method: "callLLM",
      model,
      provider: provider.name,
      strategy: strategy.name,
      messages: prompt.messages,
      system: prompt.system,
      tools: prompt.tools.map((t) => t.name),
      response: { text: "" },
      durationMs: Date.now() - t0,
      error,
    });
    throw new Error(error);
  }

  const data = await res.json();
  const providerResponse = provider.parseResponse(data);
  const { text, toolCalls } = strategy.parseResponse(providerResponse, prompt);
  const result: LLMResponse = {
    text,
    toolCalls,
    raw: data,
    request: { url, body, prepared },
    finishReason: providerResponse.finishReason,
    usage: providerResponse.usage,
  };

  fireHooks({
    id: generateId(),
    timestamp: t0,
    method: "callLLM",
    model,
    provider: provider.name,
    strategy: strategy.name,
    messages: prompt.messages,
    system: prompt.system,
    tools: prompt.tools.map((t) => t.name),
    response: { text, toolCalls },
    usage: providerResponse.usage,
    durationMs: Date.now() - t0,
  });
  return result;
}

export function render(tree: JsxAiNode): ExtractedPrompt {
  return extract(tree);
}

export async function callText(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: RequestOptions & {
    provider?: ProviderName;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  const t0 = Date.now();
  const provider = resolveProvider(model, options?.provider);
  const apiKey = resolveApiKey(provider, options);
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const nonSystem: ExtractedMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
  const prepared: PreparedPrompt = {
    system: system || undefined,
    messages: nonSystem,
    temperature: options?.temperature ?? 0.3,
    maxTokens: options?.maxTokens ?? 8000,
  };
  const { url, headers, body } = provider.buildRequest(prepared, model, apiKey);
  const res = await fetchWithRetry(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    options,
  );
  if (!res.ok)
    throw new Error(
      `LLM API error ${res.status}: ${(await res.text()).substring(0, 500)}`,
    );
  const parsed = provider.parseResponse(await res.json());
  fireHooks({
    id: generateId(),
    timestamp: t0,
    method: "callText",
    model,
    provider: provider.name,
    messages,
    system,
    response: { text: parsed.text },
    usage: parsed.usage,
    durationMs: Date.now() - t0,
  });
  return parsed.text;
}

export async function* streamLLM(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: RequestOptions & {
    provider?: ProviderName;
    temperature?: number;
    maxTokens?: number;
  },
): AsyncGenerator<string> {
  const provider = resolveProvider(model, options?.provider);
  if (!provider.buildStreamRequest || !provider.parseStreamEvent) {
    throw new Error(`Provider ${provider.name} does not implement streaming`);
  }
  const apiKey = resolveApiKey(provider, options);
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const prepared: PreparedPrompt = {
    system: system || undefined,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    temperature: options?.temperature ?? 0.3,
    maxTokens: options?.maxTokens ?? 8000,
  };
  const { url, headers, body } = provider.buildStreamRequest(
    prepared,
    model,
    apiKey,
  );
  const res = await fetchWithRetry(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    options,
  );
  if (!res.ok)
    throw new Error(
      `LLM stream failed (${res.status}): ${(await res.text()).substring(0, 300)}`,
    );
  yield* parseSSEStream(res, provider.parseStreamEvent.bind(provider));
}

// ── Transport ──

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(1000 * Math.pow(2, attempt), 10_000);
}

function attemptSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromExternal = () => controller.abort(external?.reason);

  if (external?.aborted) controller.abort(external.reason);
  else external?.addEventListener("abort", abortFromExternal, { once: true });

  timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      external?.removeEventListener("abort", abortFromExternal);
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(signal.reason || new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RequestOptions,
): Promise<Response> {
  const retries = Math.max(0, options?.retries ?? 3);
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 60_000);
  const externalSignal = options?.signal;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (externalSignal?.aborted)
      throw externalSignal.reason || new Error("Aborted");
    const { signal, cleanup } = attemptSignal(timeoutMs, externalSignal);
    try {
      const response = await fetch(url, { ...init, signal });
      cleanup();
      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;
      if (!retryable || attempt === retries) return response;
      const delay = retryDelayMs(response, attempt);
      try {
        await response.body?.cancel();
      } catch {}
      await sleep(delay, externalSignal);
    } catch (error) {
      cleanup();
      lastError = error;
      if (externalSignal?.aborted) throw externalSignal.reason || error;
      if (attempt === retries) throw error;
      await sleep(
        Math.min(1000 * Math.pow(2, attempt), 10_000),
        externalSignal,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Request retries exhausted");
}

async function* parseSSEStream(
  res: Response,
  extractText: (json: any) => string,
): AsyncGenerator<string> {
  if (!res.body) throw new Error("Streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const text = extractText(JSON.parse(payload));
        if (text) yield text;
      } catch {}
    }
  }
}
