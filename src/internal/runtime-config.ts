import { JsxAiError } from "../errors";

export type RuntimeName = "api" | "codex";

export interface RuntimeConfigInput {
  runtime?: RuntimeName;
  model?: string;
}

export interface ResolvedRuntimeConfig {
  runtime: RuntimeName;
  /** Undefined for Codex means: let the local Codex configuration choose its model. */
  model?: string;
}

const DEFAULT_API_MODEL = "gemini-2.5-flash";

function nonEmptyEnv(
  name: "JSX_AI_RUNTIME" | "JSX_AI_MODEL",
): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function runtimeFromEnvironment(): RuntimeName | undefined {
  const raw = nonEmptyEnv("JSX_AI_RUNTIME")?.toLowerCase();
  if (raw === undefined) return undefined;
  if (raw === "api" || raw === "codex") return raw;
  throw new JsxAiError(
    "INVALID_ARGUMENT",
    `Invalid JSX_AI_RUNTIME=${JSON.stringify(process.env.JSX_AI_RUNTIME)}. Expected "api" or "codex".`,
  );
}

export function modelFromEnvironment(): string | undefined {
  return nonEmptyEnv("JSX_AI_MODEL");
}

/** Resolve library-wide execution defaults. Explicit call options always win. */
export function resolveRuntimeConfig(
  input: RuntimeConfigInput = {},
  promptModel?: string,
): ResolvedRuntimeConfig {
  const runtime = input.runtime ?? runtimeFromEnvironment() ?? "api";
  const model =
    input.model ??
    modelFromEnvironment() ??
    promptModel ??
    (runtime === "api" ? DEFAULT_API_MODEL : undefined);
  return model ? { runtime, model } : { runtime };
}
