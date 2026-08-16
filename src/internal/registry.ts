import { JsxAiError } from "../errors";
import type { Provider } from "../providers/provider";
import { AnthropicProvider } from "../providers/anthropic";
import { GeminiProvider } from "../providers/gemini";
import { OpenAIProvider } from "../providers/openai";
import { hybrid } from "../strategies/hybrid";
import { native } from "../strategies/native";
import { natural } from "../strategies/natural";
import { nlt } from "../strategies/nlt";
import { xml } from "../strategies/xml";
import type {
  BuiltinProviderName,
  ExtractedPrompt,
  ProviderName,
  RenderStrategy,
  StrategyName,
} from "../types";

const strategies = new Map<string, RenderStrategy>([
  ["native", native],
  ["xml", xml],
  ["natural", natural],
  ["hybrid", hybrid],
  ["nlt", nlt],
]);

const providers = new Map<string, Provider>([
  ["gemini", new GeminiProvider()],
  ["openai", new OpenAIProvider()],
  ["anthropic", new AnthropicProvider()],
]);

function registrationName(name: string, kind: "provider" | "strategy"): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `Cannot register an empty ${kind} name`,
    );
  }
  return normalized;
}

function install<T extends { readonly name: string }>(
  registry: Map<string, T>,
  kind: "provider" | "strategy",
  name: string,
  value: T,
): () => void {
  const normalized = registrationName(name, kind);
  if (value.name !== normalized) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `${kind} registration name "${normalized}" must match ${kind}.name "${value.name}"`,
    );
  }

  const previous = registry.get(normalized);
  registry.set(normalized, value);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (registry.get(normalized) !== value) return;
    if (previous) registry.set(normalized, previous);
    else registry.delete(normalized);
  };
}

export function registerProvider(provider: Provider): () => void;
export function registerProvider(name: string, provider: Provider): () => void;
export function registerProvider(
  nameOrProvider: string | Provider,
  maybeProvider?: Provider,
): () => void {
  const provider =
    typeof nameOrProvider === "string" ? maybeProvider : nameOrProvider;
  if (!provider) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      "registerProvider requires a provider",
    );
  }
  const name =
    typeof nameOrProvider === "string" ? nameOrProvider : provider.name;
  return install(providers, "provider", name, provider);
}

export function registerStrategy(strategy: RenderStrategy): () => void;
export function registerStrategy(
  name: string,
  strategy: RenderStrategy,
): () => void;
export function registerStrategy(
  nameOrStrategy: string | RenderStrategy,
  maybeStrategy?: RenderStrategy,
): () => void {
  const strategy =
    typeof nameOrStrategy === "string" ? maybeStrategy : nameOrStrategy;
  if (!strategy) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      "registerStrategy requires a strategy",
    );
  }
  const name =
    typeof nameOrStrategy === "string" ? nameOrStrategy : strategy.name;
  const normalized = registrationName(name, "strategy");
  if (normalized === "auto") {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      '"auto" is reserved and cannot be registered as a strategy',
    );
  }
  return install(strategies, "strategy", normalized, strategy);
}

export function listProviders(): readonly string[] {
  return [...providers.keys()];
}

export function listStrategies(): readonly string[] {
  return ["auto", ...strategies.keys()];
}

export function resolveStrategy(
  prompt: ExtractedPrompt,
  override?: StrategyName,
): RenderStrategy {
  const choice = String(override ?? prompt.strategy ?? "auto");
  if (choice === "auto") return hybrid;
  const strategy = strategies.get(choice);
  if (!strategy) {
    throw new JsxAiError(
      "UNKNOWN_STRATEGY",
      `Unknown strategy: ${choice}. Available: ${listStrategies().join(", ")}`,
    );
  }
  return strategy;
}

export function detectProvider(model: string): BuiltinProviderName {
  if (/^(gpt-|o[0-9]|chatgpt)/i.test(model)) return "openai";
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(deepseek|qwen)/i.test(model)) return "openai";
  return "gemini";
}

export function resolveProvider(
  model: string,
  override?: ProviderName,
): Provider {
  const name = String(override ?? detectProvider(model));
  const provider = providers.get(name);
  if (!provider) {
    throw new JsxAiError(
      "UNKNOWN_PROVIDER",
      `Unknown provider: ${name}. Available: ${listProviders().join(", ")}`,
    );
  }
  return provider;
}
