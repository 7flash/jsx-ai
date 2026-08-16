import { readFileSync } from "fs";
import { resolve as resolvePath } from "path";
import type { Provider } from "../providers/provider";
import type { RequestOptions } from "./transport";
import { errorCode } from "./errors";

function configApiKey(providerName: string): string | undefined {
  let toml: string;
  try {
    toml = readFileSync(resolvePath(process.cwd(), ".config.toml"), "utf-8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }

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
  return undefined;
}

export function resolveApiKey(
  provider: Provider,
  options?: RequestOptions,
): string {
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
    `No API key found for ${provider.name}. Pass apiKey, set a provider-specific environment variable, ` +
      `or add [${provider.name}] api_key to .config.toml.`,
  );
}
