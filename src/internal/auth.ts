import { readFileSync } from "fs";
import { resolve as resolvePath } from "path";
import { JsxAiError } from "../errors";
import type { Provider } from "../providers/provider";
import type { RequestOptions } from "./transport";
import { errorCode } from "./errors";

function configApiKey(sectionNames: readonly string[]): string | undefined {
  let toml: string;
  try {
    toml = readFileSync(resolvePath(process.cwd(), ".config.toml"), "utf-8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }

  let section = "";
  const acceptedSections = new Set(
    sectionNames.flatMap((name) => {
      const normalized = name.toLowerCase();
      return [normalized, `provider.${normalized}`, `providers.${normalized}`];
    }),
  );
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

interface CredentialRoute {
  label: string;
  env: readonly string[];
  configSections: readonly string[];
}

function credentialRoute(provider: Provider, model?: string): CredentialRoute {
  if (provider.name === "openai") {
    const normalizedModel = model?.trim().toLowerCase() ?? "";
    if (normalizedModel.startsWith("deepseek")) {
      return {
        label: "DeepSeek",
        env: ["DEEPSEEK_API_KEY"],
        configSections: ["deepseek"],
      };
    }
    if (normalizedModel.startsWith("qwen")) {
      return {
        label: "Qwen/DashScope",
        env: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
        configSections: ["qwen", "dashscope"],
      };
    }
    return {
      label: "OpenAI",
      env: ["OPENAI_API_KEY"],
      configSections: ["openai"],
    };
  }

  if (provider.name === "anthropic") {
    return {
      label: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      configSections: ["anthropic"],
    };
  }

  return {
    label: "Gemini",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    configSections: ["gemini"],
  };
}

export function resolveApiKey(
  provider: Provider,
  model?: string,
  options?: RequestOptions,
): string {
  if (options?.apiKey) return options.apiKey;

  const route = credentialRoute(provider, model);
  for (const name of route.env) {
    const value = process.env[name];
    if (value) return value;
  }

  const config = configApiKey(route.configSections);
  if (config) return config;

  const envHint = route.env.join(" or ");
  const configHint = route.configSections
    .map((name) => `[${name}] api_key`)
    .join(" or ");
  throw new JsxAiError(
    "MISSING_API_KEY",
    `No API key found for ${route.label}. Pass apiKey, set ${envHint}, ` +
      `or add ${configHint} to .config.toml.`,
  );
}
