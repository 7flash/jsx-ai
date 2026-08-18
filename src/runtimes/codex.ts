import { JsxAiError } from "../errors";
import {
  addAgentRuntimeCleanup,
  type AgentRuntimeContext,
} from "../internal/agent-runtime";
import { jsonSchemaToJson, normalizeToolCall } from "../ir";
import { StructuredAgentDeltaDecoder } from "../internal/structured-agent-delta";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsonObject,
  LLMResponse,
  ToolCall,
} from "../types";
import {
  CodexAppServerRuntime,
  type CodexAppServerThread,
  type CodexAppServerUsage,
} from "./codex-app-server";
import type { CodexRuntimeCallOptions } from "./codex-common";

export type {
  CodexApprovalPolicy,
  CodexAuthMode,
  CodexReasoningEffort,
  CodexRuntimeCallOptions,
  CodexRuntimeOptions,
  CodexSandboxMode,
  CodexWebSearchMode,
} from "./codex-common";

type CodexBridgeMode = "initial" | "delta" | "contract-update" | "resync";

interface CodexAgentSession {
  readonly kind: "jsx-ai-codex-agent-session";
  readonly configKey: string;
  readonly runtime: CodexAppServerRuntime;
  thread: CodexAppServerThread;
  turn: number;
  syncedMessages: readonly ExtractedMessage[];
  contractKey?: string;
  lastResponse?: { text: string; toolCalls: readonly ToolCall[] };
}

interface CodexBridgeInput {
  mode: CodexBridgeMode;
  text: string;
  messagesSent: number;
}

interface CodexStructuredCall {
  text: string;
  toolCalls: Array<{ name: string; arguments_json: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codexSessionConfigKey(
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): string {
  return JSON.stringify({
    model: model ?? null,
    codex: options?.codex ?? null,
    apiKey: options?.apiKey ? "explicit" : null,
  });
}

function isCodexAgentSession(value: unknown): value is CodexAgentSession {
  return isRecord(value) && value.kind === "jsx-ai-codex-agent-session";
}

function promptContractKey(prompt: ExtractedPrompt): string {
  return JSON.stringify({
    system: prompt.system ?? "",
    applicationTools: prompt.tools.map(toolForCodex),
  });
}

function sameMessage(left: ExtractedMessage, right: ExtractedMessage): boolean {
  return (
    JSON.stringify(messageForCodex(left)) ===
    JSON.stringify(messageForCodex(right))
  );
}

function hasMessagePrefix(
  messages: readonly ExtractedMessage[],
  prefix: readonly ExtractedMessage[],
): boolean {
  if (prefix.length > messages.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (!sameMessage(messages[index]!, prefix[index]!)) return false;
  }
  return true;
}

function sameToolRequest(
  message: ExtractedMessage,
  last?: { text: string; toolCalls: readonly ToolCall[] },
): boolean {
  if (!last || message.role !== "assistant") return false;
  if (message.content !== last.text) return false;
  const messageCalls = message.toolCalls ?? [];
  if (messageCalls.length !== last.toolCalls.length) return false;
  return messageCalls.every((call, index) => {
    const previous = last.toolCalls[index];
    return (
      previous !== undefined &&
      call.name === previous.name &&
      JSON.stringify(call.args) === JSON.stringify(previous.args)
    );
  });
}

function deltaPromptText(
  messages: readonly ExtractedMessage[],
  contract?: JsonObject,
): string {
  const payload: JsonObject = {
    ...(contract ? { updatedContract: contract } : {}),
    newMessages: messages.map(messageForCodex),
  };
  return [
    contract
      ? "Continue the same jsx-ai agent conversation. The host application contract has changed; the updated contract below supersedes the previous one."
      : "Continue the same jsx-ai agent conversation using only the new host messages below.",
    "Do not perform declared application tools yourself. Return the structured assistant response required by the output schema.",
    "Tool-result messages are observations from application tools you requested in your previous response.",
    "Do not repeat completed host actions unless the new messages require them.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function bridgeInput(
  session: CodexAgentSession,
  prompt: ExtractedPrompt,
): CodexBridgeInput {
  if (session.turn === 0) {
    return {
      mode: "initial",
      text: canonicalPromptText(prompt),
      messagesSent: prompt.messages.length,
    };
  }

  if (!hasMessagePrefix(prompt.messages, session.syncedMessages)) {
    return {
      mode: "resync",
      text: canonicalPromptText(prompt),
      messagesSent: prompt.messages.length,
    };
  }

  let delta = prompt.messages.slice(session.syncedMessages.length);
  if (delta.length && sameToolRequest(delta[0]!, session.lastResponse)) {
    // The native Codex thread already contains its previous assistant response.
    // Canonical history keeps it for provider-neutral semantics, but resending
    // it would duplicate context inside Codex.
    delta = delta.slice(1);
  }

  const nextContractKey = promptContractKey(prompt);
  const contractChanged = session.contractKey !== nextContractKey;
  const contract = contractChanged
    ? {
        system: prompt.system ?? "",
        applicationTools: prompt.tools.map(toolForCodex),
      }
    : undefined;

  return {
    mode: contractChanged ? "contract-update" : "delta",
    text: deltaPromptText(delta, contract),
    messagesSent: delta.length,
  };
}

async function createCodexAgentSession(
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<CodexAgentSession> {
  const runtime = await CodexAppServerRuntime.create(options);
  try {
    const thread = await runtime.startThread(model, options?.codex, true);
    return {
      kind: "jsx-ai-codex-agent-session",
      configKey: codexSessionConfigKey(model, options),
      runtime,
      thread,
      turn: 0,
      syncedMessages: [],
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

async function codexAgentSession(
  runtimeContext: AgentRuntimeContext | undefined,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<{ session: CodexAgentSession; owned: boolean }> {
  const key = codexSessionConfigKey(model, options);
  if (
    runtimeContext &&
    isCodexAgentSession(runtimeContext.codex) &&
    runtimeContext.codex.configKey === key
  ) {
    return { session: runtimeContext.codex, owned: false };
  }

  if (runtimeContext && isCodexAgentSession(runtimeContext.codex)) {
    await runtimeContext.codex.runtime.close();
    runtimeContext.codex = undefined;
  }

  const session = await createCodexAgentSession(model, options);
  if (!runtimeContext) return { session, owned: true };

  runtimeContext.codex = session;
  addAgentRuntimeCleanup(runtimeContext, () => session.runtime.close());
  return { session, owned: false };
}

async function restartCodexThread(
  session: CodexAgentSession,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<void> {
  session.thread = await session.runtime.startThread(
    model,
    options?.codex,
    true,
  );
  session.turn = 0;
  session.syncedMessages = [];
  session.contractKey = undefined;
  session.lastResponse = undefined;
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
  threadId: string,
  turn: number,
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
      `codex_${threadId}_${turn}_${index}_${call.name}`,
      `Codex runtime toolCalls[${index}]`,
    );
  });
}

function usageFromCodex(usage?: CodexAppServerUsage): LLMResponse["usage"] {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.reasoningOutputTokens !== undefined
      ? { thinkingTokens: usage.reasoningOutputTokens }
      : {}),
  };
}

/** Execute one canonical jsx-ai model step through a local Codex App Server. */
export async function callCodexRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
  runtimeContext?: AgentRuntimeContext,
): Promise<LLMResponse> {
  const { session, owned } = await codexAgentSession(
    runtimeContext,
    model,
    options,
  );
  try {
    let bridge = bridgeInput(session, prompt);

    if (bridge.mode === "resync") {
      // Append-only canonical history is required for safe delta turns. If a
      // caller rewrites history inside one run, start a fresh native thread
      // rather than duplicating an old conversation into the existing one.
      await restartCodexThread(session, model, options);
      bridge = {
        mode: "resync",
        text: canonicalPromptText(prompt),
        messagesSent: prompt.messages.length,
      };
    }

    const schema = outputSchema(prompt);
    const turnNumber = session.turn + 1;
    const deltaDecoder = new StructuredAgentDeltaDecoder();
    const wantsStructuredProgress = Boolean(
      runtimeContext?.onTextDelta || runtimeContext?.onToolProgress,
    );
    const turn = await session.thread.run(bridge.text, {
      ...options,
      outputSchema: schema,
      onProgress: runtimeContext?.onProgress,
      onTextDelta: wantsStructuredProgress
        ? async (rawDelta) => {
            const decoded = deltaDecoder.push(rawDelta);
            if (decoded.textDelta)
              await runtimeContext?.onTextDelta?.(decoded.textDelta);
            for (const progress of decoded.toolProgress) {
              await runtimeContext?.onToolProgress?.(progress);
            }
          }
        : undefined,
    });
    const structured = parseStructuredCall(turn.finalResponse);

    // Some Codex builds may expose only item/completed for structured turns.
    // In that case, still honor the agent text callback once at turn completion.
    if (runtimeContext?.onTextDelta && !deltaDecoder.text && structured.text) {
      await runtimeContext.onTextDelta(structured.text);
    } else if (
      runtimeContext?.onTextDelta &&
      structured.text.startsWith(deltaDecoder.text) &&
      structured.text.length > deltaDecoder.text.length
    ) {
      await runtimeContext.onTextDelta(
        structured.text.slice(deltaDecoder.text.length),
      );
    }
    const toolCalls = normalizedToolCalls(
      prompt,
      structured,
      session.thread.id,
      turnNumber,
    );

    session.turn = turnNumber;
    session.syncedMessages = prompt.messages;
    session.contractKey = promptContractKey(prompt);
    session.lastResponse = { text: structured.text, toolCalls };

    return {
      text: structured.text,
      toolCalls,
      raw: {
        runtime: "codex",
        transport: "app-server",
        threadId: session.thread.id,
        threadTurn: turnNumber,
        bridgeMode: bridge.mode,
        bridgePromptChars: bridge.text.length,
        bridgeMessagesSent: bridge.messagesSent,
        items: turn.items,
        usage: turn.usage ?? null,
        finalResponse: turn.finalResponse,
        stream: turn.stream,
      },
      request: {
        url: "codex://app-server",
        body: {
          runtime: "codex",
          transport: "app-server",
          ...(model ? { model } : {}),
          threadId: session.thread.id,
          threadTurn: turnNumber,
          bridgeMode: bridge.mode,
          bridgePromptChars: bridge.text.length,
          bridgeMessagesSent: bridge.messagesSent,
          bridgeMessagesTotal: prompt.messages.length,
          prompt: bridge.text,
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
  } finally {
    if (owned) await session.runtime.close();
  }
}

/** Execute plain text messages through Codex without application tools. */
export async function callCodexTextRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): Promise<LLMResponse> {
  const runtime = await CodexAppServerRuntime.create(options);
  try {
    const thread = await runtime.startThread(model, options?.codex, true);
    const promptText = canonicalTextPrompt(prompt);
    const turn = await thread.run(promptText, options);
    return {
      text: turn.finalResponse,
      toolCalls: [],
      raw: {
        runtime: "codex",
        transport: "app-server",
        threadId: thread.id,
        items: turn.items,
        usage: turn.usage ?? null,
        finalResponse: turn.finalResponse,
        stream: turn.stream,
      },
      request: {
        url: "codex://app-server",
        body: {
          runtime: "codex",
          transport: "app-server",
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
  } finally {
    await runtime.close();
  }
}

/** Stream plain assistant text deltas through the same Codex App Server transport. */
export async function* streamCodexTextRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): AsyncGenerator<string> {
  const runtime = await CodexAppServerRuntime.create(options);
  try {
    const thread = await runtime.startThread(model, options?.codex, true);
    const promptText = canonicalTextPrompt(prompt);
    for await (const chunk of thread.streamText(promptText, options))
      yield chunk;
  } finally {
    await runtime.close();
  }
}
