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
  if (!normalized) throw new Error(`Cannot register an empty ${kind} name`);
  return normalized;
}

export function registerProvider(name: string, provider: Provider): void {
  providers.set(registrationName(name, "provider"), provider);
}

export function registerStrategy(name: string, strategy: RenderStrategy): void {
  const normalized = registrationName(name, "strategy");
  if (normalized === "auto")
    throw new Error(
      '"auto" is reserved and cannot be registered as a strategy',
    );
  strategies.set(normalized, strategy);
}

export function resolveStrategy(
  prompt: ExtractedPrompt,
  override?: StrategyName,
): RenderStrategy {
  const choice = String(override ?? prompt.strategy ?? "auto");
  if (choice === "auto") return hybrid;
  const strategy = strategies.get(choice);
  if (!strategy)
    throw new Error(
      `Unknown strategy: ${choice}. Available: auto, ${[...strategies.keys()].join(", ")}`,
    );
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
  if (!provider)
    throw new Error(
      `Unknown provider: ${name}. Available: ${[...providers.keys()].join(", ")}`,
    );
  return provider;
}
