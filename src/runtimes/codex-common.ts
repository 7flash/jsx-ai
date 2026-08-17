import { JsxAiError, RequestTimeoutError } from "../errors";
import { abortReason } from "../internal/errors";

export const DEFAULT_CODEX_TURN_TIMEOUT_MS = 60_000;

export type CodexSandboxMode =
  "read-only" | "workspace-write" | "danger-full-access";
export type CodexReasoningEffort =
  "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexWebSearchMode = "disabled" | "cached" | "live";
export type CodexApprovalPolicy =
  "never" | "on-request" | "on-failure" | "untrusted";
export type CodexAuthMode = "chatgpt" | "inherit";

/** Options passed to the local Codex runtime when CallOptions.runtime === "codex". */
export interface CodexRuntimeOptions {
  /**
   * "chatgpt" (default) removes API-key variables from the Codex child process so
   * the saved `codex login` session is used. "inherit" passes the current process
   * environment through unchanged.
   */
  auth?: CodexAuthMode;
  /** Codex sandbox. jsx-ai defaults its model-backend adapter to read-only. */
  sandboxMode?: CodexSandboxMode;
  workingDirectory?: string;
  /**
   * Retained for compatibility with earlier jsx-ai Codex configuration. App Server
   * does not require a Git repository, so this option is a no-op.
   */
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: CodexReasoningEffort;
  /** Defaults to false when jsx-ai configures workspace-write networking. */
  networkAccessEnabled?: boolean;
  /** Defaults to disabled for the model-backend adapter. */
  webSearchMode?: CodexWebSearchMode;
  /** Defaults to never; application tools remain owned by runAgent/the caller. */
  approvalPolicy?: CodexApprovalPolicy;
  /** Additional writable roots when workspace-write is explicitly selected. */
  additionalDirectories?: readonly string[];
  /** Optional path to a specific Codex executable. Normally unnecessary. */
  codexPathOverride?: string;
}

export interface CodexRuntimeCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Explicit API keys are intentionally rejected by the ChatGPT-authenticated Codex runtime. */
  apiKey?: string;
  codex?: CodexRuntimeOptions;
}

export interface CodexOperationSignal {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
  cleanup(): void;
}

export function codexEnvironment(
  options?: CodexRuntimeOptions,
  explicitApiKey?: string,
): NodeJS.ProcessEnv {
  if (explicitApiKey) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      'runtime="codex" does not accept apiKey. Use runtime="api" for explicit OpenAI API-key billing, or remove apiKey and authenticate Codex with `bunx @openai/codex login` (or `codex login`).',
    );
  }

  if ((options?.auth ?? "chatgpt") === "inherit") return { ...process.env };

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (normalized === "OPENAI_API_KEY" || normalized === "CODEX_API_KEY")
      continue;
    env[key] = value;
  }
  return env;
}

export function codexOperationSignal(
  timeoutMs: number | undefined,
  external?: AbortSignal,
): CodexOperationSignal {
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_CODEX_TURN_TIMEOUT_MS;
  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `timeoutMs must be a finite positive number; received ${effectiveTimeoutMs}`,
    );
  }

  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new RequestTimeoutError(effectiveTimeoutMs)),
    effectiveTimeoutMs,
  );

  return {
    signal: external
      ? AbortSignal.any([external, timeout.signal])
      : timeout.signal,
    timeoutSignal: timeout.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export function throwCodexOperationError(
  error: unknown,
  operation: CodexOperationSignal,
  externalSignal?: AbortSignal,
  label = "Codex runtime",
): never {
  if (externalSignal?.aborted) throw abortReason(externalSignal);
  if (operation.timeoutSignal.aborted) {
    const reason = operation.timeoutSignal.reason;
    if (reason instanceof RequestTimeoutError) throw reason;
  }
  if (error instanceof JsxAiError) throw error;

  const message = error instanceof Error ? error.message : String(error);
  const authHint = isLikelyAuthError(message)
    ? " If you intended to use ChatGPT-managed auth, run `bunx @openai/codex login` (or `codex login`) first."
    : "";
  throw new JsxAiError(
    "RUNTIME_ERROR",
    `${label} failed: ${message}.${authHint}`,
    {
      cause: error,
    },
  );
}

function isLikelyAuthError(message: string): boolean {
  return /(?:401|403|unauthori[sz]ed|authentication|not logged in|login required|missing credentials?|invalid api key)/i.test(
    message,
  );
}
