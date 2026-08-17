import { JsxAiError, RequestTimeoutError } from "../errors";
import { abortReason } from "../internal/errors";
import { jsonSchemaToJson, normalizeToolCall } from "../ir";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsonObject,
  LLMResponse,
  ToolCall,
} from "../types";

const CODEX_SDK_PACKAGE = "@openai/codex-sdk";

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
  /** Codex sandbox. jsx-ai defaults this adapter to read-only. */
  sandboxMode?: CodexSandboxMode;
  workingDirectory?: string;
  /** Defaults to true so JSX calls also work outside Git repositories. */
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: CodexReasoningEffort;
  /** Defaults to false for the model-backend adapter. */
  networkAccessEnabled?: boolean;
  /** Defaults to disabled for the model-backend adapter. */
  webSearchMode?: CodexWebSearchMode;
  /** Defaults to never; application tools remain owned by runAgent/the caller. */
  approvalPolicy?: CodexApprovalPolicy;
  additionalDirectories?: readonly string[];
  /** Optional path to a specific Codex executable. Normally unnecessary. */
  codexPathOverride?: string;
}

interface CodexSdkModule {
  Codex: new (options?: CodexClientOptions) => CodexClient;
}

interface CodexClientOptions {
  codexPathOverride?: string;
  env?: Record<string, string>;
}

interface CodexThreadOptions {
  model?: string;
  sandboxMode?: CodexSandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: CodexReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: CodexWebSearchMode;
  approvalPolicy?: CodexApprovalPolicy;
  additionalDirectories?: string[];
}

interface CodexRunOptions {
  outputSchema?: JsonObject;
  signal?: AbortSignal;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexTurn {
  finalResponse: string;
  items?: unknown[];
  usage?: CodexUsage | null;
}

interface CodexThread {
  readonly id?: string | null;
  run(input: string, options?: CodexRunOptions): Promise<CodexTurn>;
}

interface CodexClient {
  startThread(options?: CodexThreadOptions): CodexThread;
}

interface CodexStructuredCall {
  text: string;
  toolCalls: Array<{ name: string; arguments_json: string }>;
}

export interface CodexRuntimeCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Explicit API keys are intentionally rejected by the ChatGPT-authenticated Codex runtime. */
  apiKey?: string;
  codex?: CodexRuntimeOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexSdkModule(value: unknown): value is CodexSdkModule {
  return isRecord(value) && typeof value.Codex === "function";
}

type CodexSdkLoader = () => Promise<unknown>;
const defaultCodexSdkLoader: CodexSdkLoader = () => import(CODEX_SDK_PACKAGE);
let codexSdkLoader: CodexSdkLoader = defaultCodexSdkLoader;

/** Internal test seam; not re-exported from the package root. */
export function __setCodexSdkLoaderForTests(loader?: CodexSdkLoader): void {
  codexSdkLoader = loader ?? defaultCodexSdkLoader;
}

async function loadCodexSdk(): Promise<CodexSdkModule> {
  let loaded: unknown;
  try {
    loaded = await codexSdkLoader();
  } catch (cause) {
    throw new JsxAiError(
      "MISSING_RUNTIME_DEPENDENCY",
      `Codex runtime requires ${CODEX_SDK_PACKAGE}. Install it with \`bun add ${CODEX_SDK_PACKAGE}\`, then run \`bunx @openai/codex login\` (or \`codex login\`) to use ChatGPT-managed Codex auth.`,
      { cause },
    );
  }
  if (!isCodexSdkModule(loaded)) {
    throw new JsxAiError(
      "RUNTIME_ERROR",
      `${CODEX_SDK_PACKAGE} did not export Codex as expected`,
    );
  }
  return loaded;
}

function chatGptEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.toUpperCase();
    if (normalizedKey === "OPENAI_API_KEY" || normalizedKey === "CODEX_API_KEY")
      continue;
    env[key] = value;
  }
  return env;
}

function codexClientOptions(
  options?: CodexRuntimeOptions,
  explicitApiKey?: string,
): CodexClientOptions {
  const auth = options?.auth ?? "chatgpt";
  if (explicitApiKey) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      'runtime="codex" does not accept apiKey. Use runtime="api" for explicit OpenAI API-key billing, or remove apiKey and authenticate Codex with `bunx @openai/codex login` (or `codex login`).',
    );
  }

  const result: CodexClientOptions = {};
  if (auth === "chatgpt") result.env = chatGptEnvironment();
  if (options?.codexPathOverride)
    result.codexPathOverride = options.codexPathOverride;
  return result;
}

function threadOptions(
  model: string | undefined,
  options?: CodexRuntimeOptions,
): CodexThreadOptions {
  return {
    ...(model ? { model } : {}),
    sandboxMode: options?.sandboxMode ?? "read-only",
    ...(options?.workingDirectory
      ? { workingDirectory: options.workingDirectory }
      : {}),
    skipGitRepoCheck: options?.skipGitRepoCheck ?? true,
    ...(options?.modelReasoningEffort
      ? { modelReasoningEffort: options.modelReasoningEffort }
      : {}),
    networkAccessEnabled: options?.networkAccessEnabled ?? false,
    webSearchMode: options?.webSearchMode ?? "disabled",
    approvalPolicy: options?.approvalPolicy ?? "never",
    ...(options?.additionalDirectories
      ? { additionalDirectories: [...options.additionalDirectories] }
      : {}),
  };
}

interface CodexOperationSignal {
  signal?: AbortSignal;
  timeoutSignal?: AbortSignal;
  cleanup(): void;
}

function operationSignal(
  timeoutMs: number | undefined,
  external?: AbortSignal,
): CodexOperationSignal {
  if (timeoutMs === undefined) {
    return { ...(external ? { signal: external } : {}), cleanup: () => {} };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `timeoutMs must be a finite positive number; received ${timeoutMs}`,
    );
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new RequestTimeoutError(timeoutMs)),
    timeoutMs,
  );
  const signal = external
    ? AbortSignal.any([external, timeoutController.signal])
    : timeoutController.signal;

  return {
    signal,
    timeoutSignal: timeoutController.signal,
    cleanup: () => clearTimeout(timer),
  };
}

async function runCodexTurn(
  thread: CodexThread,
  input: string,
  runOptions: Omit<CodexRunOptions, "signal">,
  options?: CodexRuntimeCallOptions,
): Promise<CodexTurn> {
  const operation = operationSignal(options?.timeoutMs, options?.signal);
  try {
    return await thread.run(input, {
      ...runOptions,
      ...(operation.signal ? { signal: operation.signal } : {}),
    });
  } catch (error) {
    if (options?.signal?.aborted) throw abortReason(options.signal);
    if (operation.timeoutSignal?.aborted) {
      const reason = operation.timeoutSignal.reason;
      if (reason instanceof RequestTimeoutError) throw reason;
    }
    throw error;
  } finally {
    operation.cleanup();
  }
}

function messageForCodex(message: ExtractedMessage): JsonObject {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            toolCalls: message.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args,
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      ...(message.isError ? { isError: true } : {}),
    };
  }
  return { role: "user", content: message.content };
}

function toolForCodex(tool: ExtractedPrompt["tools"][number]): JsonObject {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToJson(tool.parameters),
  };
}

function canonicalPayload(prompt: ExtractedPrompt): JsonObject {
  return {
    system: prompt.system ?? "",
    conversation: prompt.messages.map(messageForCodex),
    applicationTools: prompt.tools.map(toolForCodex),
  };
}

function canonicalPromptText(prompt: ExtractedPrompt): string {
  return [
    "You are the model backend for jsx-ai. Treat the JSON below as the complete canonical prompt.",
    "Do not perform the declared application tools yourself. They belong to the host application.",
    "Decide only what the assistant should say and which application tools it should request next.",
    "Return the structured response required by the output schema.",
    "For each requested tool, copy its exact declared name and put a valid JSON object in arguments_json.",
    "If no application tool should be called, return an empty toolCalls array.",
    "Do not claim a host-side action occurred unless the conversation contains its tool result.",
    "",
    JSON.stringify(canonicalPayload(prompt), null, 2),
  ].join("\n");
}

function canonicalTextPrompt(prompt: ExtractedPrompt): string {
  return [
    "You are the model backend for jsx-ai. Treat the JSON below as the complete canonical prompt.",
    "Respond to the conversation normally with only the assistant response text.",
    "Do not describe this adapter or the JSON envelope.",
    "",
    JSON.stringify(canonicalPayload(prompt), null, 2),
  ].join("\n");
}

function outputSchema(prompt: ExtractedPrompt): JsonObject {
  const toolNames = prompt.tools.map((tool) => tool.name);
  const nameSchema: JsonObject = toolNames.length
    ? { type: "string", enum: toolNames }
    : { type: "string" };

  return {
    type: "object",
    properties: {
      text: { type: "string" },
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: nameSchema,
            arguments_json: { type: "string" },
          },
          required: ["name", "arguments_json"],
          additionalProperties: false,
        },
      },
    },
    required: ["text", "toolCalls"],
    additionalProperties: false,
  };
}

function parseStructuredCall(value: string): CodexStructuredCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new JsxAiError(
      "INVALID_RESPONSE",
      "Codex runtime returned invalid structured JSON",
      { cause },
    );
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.text !== "string" ||
    !Array.isArray(parsed.toolCalls)
  ) {
    throw new JsxAiError(
      "INVALID_RESPONSE",
      "Codex runtime response must contain text and toolCalls",
    );
  }

  const toolCalls: CodexStructuredCall["toolCalls"] = parsed.toolCalls.map(
    (entry, index) => {
      if (
        !isRecord(entry) ||
        typeof entry.name !== "string" ||
        typeof entry.arguments_json !== "string"
      ) {
        throw new JsxAiError(
          "INVALID_RESPONSE",
          `Codex runtime toolCalls[${index}] is malformed`,
        );
      }
      return { name: entry.name, arguments_json: entry.arguments_json };
    },
  );
  return { text: parsed.text, toolCalls };
}

function jsonObjectFromString(value: string, context: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new JsxAiError("INVALID_RESPONSE", `${context} is not valid JSON`, {
      cause,
    });
  }
  if (!isRecord(parsed)) {
    throw new JsxAiError(
      "INVALID_RESPONSE",
      `${context} must decode to a JSON object`,
    );
  }
  return parsed as JsonObject;
}

function normalizedToolCalls(
  prompt: ExtractedPrompt,
  structured: CodexStructuredCall,
  threadId?: string | null,
): ToolCall[] {
  const declared = new Set(prompt.tools.map((tool) => tool.name));
  return structured.toolCalls.map((call, index) => {
    if (!declared.has(call.name)) {
      throw new JsxAiError(
        "INVALID_RESPONSE",
        `Codex runtime requested undeclared tool ${JSON.stringify(call.name)}`,
      );
    }
    return normalizeToolCall(
      {
        name: call.name,
        args: jsonObjectFromString(
          call.arguments_json,
          `Codex tool call ${call.name} arguments_json`,
        ),
      },
      `codex_${threadId ?? "thread"}_${index}_${call.name}`,
      `Codex runtime toolCalls[${index}]`,
    );
  });
}

function usageFromCodex(usage?: CodexUsage | null): LLMResponse["usage"] {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    ...(usage.reasoning_output_tokens !== undefined
      ? { thinkingTokens: usage.reasoning_output_tokens }
      : {}),
  };
}

function runtimeError(error: unknown): never {
  if (error instanceof JsxAiError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  throw new JsxAiError(
    "RUNTIME_ERROR",
    `Codex runtime failed: ${message}. If you intended to use ChatGPT-managed auth, run \`bunx @openai/codex login\` (or \`codex login\`) first.`,
    { cause: error },
  );
}

/** Execute one canonical jsx-ai model step through the local Codex SDK. */
export async function callCodexRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<LLMResponse> {
  try {
    const sdk = await loadCodexSdk();
    const client = new sdk.Codex(
      codexClientOptions(options?.codex, options?.apiKey),
    );
    const thread = client.startThread(threadOptions(model, options?.codex));
    const promptText = canonicalPromptText(prompt);
    const schema = outputSchema(prompt);
    const turn = await runCodexTurn(
      thread,
      promptText,
      { outputSchema: schema },
      options,
    );
    const structured = parseStructuredCall(turn.finalResponse);
    const toolCalls = normalizedToolCalls(prompt, structured, thread.id);

    return {
      text: structured.text,
      toolCalls,
      raw: {
        runtime: "codex",
        threadId: thread.id ?? null,
        items: Array.isArray(turn.items) ? turn.items : [],
        usage: turn.usage ?? null,
        finalResponse: turn.finalResponse,
      },
      request: {
        url: "codex://local",
        body: {
          runtime: "codex",
          ...(model ? { model } : {}),
          prompt: promptText,
          outputSchema: schema,
        },
        prepared: {
          system: prompt.system,
          messages: prompt.messages,
          nativeTools: prompt.tools,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
        },
      },
      finishReason: "completed",
      usage: usageFromCodex(turn.usage),
    };
  } catch (error) {
    runtimeError(error);
  }
}

/** Execute plain text messages through Codex without application tools. */
export async function callCodexTextRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<LLMResponse> {
  try {
    const sdk = await loadCodexSdk();
    const client = new sdk.Codex(
      codexClientOptions(options?.codex, options?.apiKey),
    );
    const thread = client.startThread(threadOptions(model, options?.codex));
    const promptText = canonicalTextPrompt(prompt);
    const turn = await runCodexTurn(thread, promptText, {}, options);
    return {
      text: turn.finalResponse,
      toolCalls: [],
      raw: {
        runtime: "codex",
        threadId: thread.id ?? null,
        items: Array.isArray(turn.items) ? turn.items : [],
        usage: turn.usage ?? null,
        finalResponse: turn.finalResponse,
      },
      request: {
        url: "codex://local",
        body: {
          runtime: "codex",
          ...(model ? { model } : {}),
          prompt: promptText,
        },
        prepared: {
          system: prompt.system,
          messages: prompt.messages,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
        },
      },
      finishReason: "completed",
      usage: usageFromCodex(turn.usage),
    };
  } catch (error) {
    runtimeError(error);
  }
}
