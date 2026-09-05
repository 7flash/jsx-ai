import { resolve as resolvePath } from "node:path";
import {
  addAgentRuntimeCleanup,
  type AgentRuntimeContext,
} from "../internal/agent-runtime";
import { jsonSchemaToJson, normalizeToolCall } from "../ir";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsonObject,
  LLMResponse,
  MessageAttachment,
  ToolCall,
} from "../types";
import {
  CodexAppServerRuntime,
  type CodexAppServerInput,
  type CodexAppServerThread,
  type CodexAppServerUsage,
  type CodexDynamicToolCall,
  type CodexDynamicToolSpec,
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
  requiresResync: boolean;
}

interface CodexBridgeInput {
  mode: CodexBridgeMode;
  text: string;
  messagesSent: number;
  attachments: readonly MessageAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codexSessionConfigKey(
  model: string | undefined,
  options: CodexRuntimeCallOptions | undefined,
  prompt: ExtractedPrompt,
): string {
  return JSON.stringify({
    model: model ?? null,
    codex: options?.codex ?? null,
    apiKey: options?.apiKey ? "explicit" : null,
    dynamicTools: prompt.tools.map(dynamicToolForCodex),
  });
}

function isCodexAgentSession(value: unknown): value is CodexAgentSession {
  return isRecord(value) && value.kind === "jsx-ai-codex-agent-session";
}

function promptContractKey(prompt: ExtractedPrompt): string {
  return JSON.stringify({ system: prompt.system ?? "" });
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

function messageAttachments(
  messages: readonly ExtractedMessage[],
): MessageAttachment[] {
  return messages.flatMap((message) => message.attachments ?? []);
}

function codexTurnInput(
  bridge: CodexBridgeInput,
  options?: CodexRuntimeCallOptions,
): CodexAppServerInput[] {
  const cwd = options?.codex?.workingDirectory ?? process.cwd();
  return [
    { type: "text", text: bridge.text },
    ...bridge.attachments.map((attachment) => ({
      type: "localImage" as const,
      path: resolvePath(cwd, attachment.path),
    })),
  ];
}

function deltaPromptText(
  messages: readonly ExtractedMessage[],
  updatedSystem?: string,
): string {
  const payload: JsonObject = {
    ...(updatedSystem !== undefined ? { updatedSystem } : {}),
    newMessages: messages.map(messageForCodex),
  };
  return [
    updatedSystem !== undefined
      ? "Continue the same jsx-ai conversation. The system instruction below supersedes the previous one."
      : "Continue the same jsx-ai conversation using only the new canonical messages below.",
    "Application tools are exposed through Codex native dynamic tools; use them directly when needed.",
    "You may invoke multiple independent application tools in the same turn.",
    "If a dynamic tool reports that execution is deferred to the host, do not retry it or issue dependent calls in this turn. Finish the turn and wait for the real tool result in the next canonical message.",
    "Tool-result messages are observations from application tools requested previously.",
    "Any local images attached to this turn correspond in order to attachment records in newMessages.",
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
      attachments: messageAttachments(prompt.messages),
    };
  }

  if (!hasMessagePrefix(prompt.messages, session.syncedMessages)) {
    return {
      mode: "resync",
      text: canonicalPromptText(prompt),
      messagesSent: prompt.messages.length,
      attachments: messageAttachments(prompt.messages),
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

  return {
    mode: contractChanged ? "contract-update" : "delta",
    text: deltaPromptText(
      delta,
      contractChanged ? (prompt.system ?? "") : undefined,
    ),
    messagesSent: delta.length,
    attachments: messageAttachments(delta),
  };
}

async function createCodexAgentSession(
  model: string | undefined,
  options: CodexRuntimeCallOptions | undefined,
  prompt: ExtractedPrompt,
): Promise<CodexAgentSession> {
  const runtime = await CodexAppServerRuntime.create(options);
  try {
    const thread = await runtime.startThread(
      model,
      options?.codex,
      true,
      prompt.tools.map(dynamicToolForCodex),
    );
    return {
      kind: "jsx-ai-codex-agent-session",
      configKey: codexSessionConfigKey(model, options, prompt),
      runtime,
      thread,
      turn: 0,
      syncedMessages: [],
      requiresResync: false,
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

async function codexAgentSession(
  runtimeContext: AgentRuntimeContext | undefined,
  model: string | undefined,
  options: CodexRuntimeCallOptions | undefined,
  prompt: ExtractedPrompt,
): Promise<{ session: CodexAgentSession; owned: boolean }> {
  const key = codexSessionConfigKey(model, options, prompt);
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

  const session = await createCodexAgentSession(model, options, prompt);
  if (!runtimeContext) return { session, owned: true };

  runtimeContext.codex = session;
  addAgentRuntimeCleanup(runtimeContext, () => session.runtime.close());
  return { session, owned: false };
}

async function restartCodexThread(
  session: CodexAgentSession,
  model: string | undefined,
  options: CodexRuntimeCallOptions | undefined,
  prompt: ExtractedPrompt,
): Promise<void> {
  session.thread = await session.runtime.startThread(
    model,
    options?.codex,
    true,
    prompt.tools.map(dynamicToolForCodex),
  );
  session.turn = 0;
  session.syncedMessages = [];
  session.contractKey = undefined;
  session.lastResponse = undefined;
  session.requiresResync = false;
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
      ...(message.attachments?.length
        ? { attachments: message.attachments.map(attachmentForCodex) }
        : {}),
    };
  }
  return {
    role: "user",
    content: message.content,
    ...(message.attachments?.length
      ? { attachments: message.attachments.map(attachmentForCodex) }
      : {}),
  };
}

function attachmentForCodex(attachment: MessageAttachment): JsonObject {
  return {
    type: attachment.type,
    path: attachment.path,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.alt ? { alt: attachment.alt } : {}),
  };
}

function dynamicToolForCodex(
  tool: ExtractedPrompt["tools"][number],
): CodexDynamicToolSpec {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: jsonSchemaToJson(tool.parameters),
  };
}

function canonicalPayload(prompt: ExtractedPrompt): JsonObject {
  return {
    system: prompt.system ?? "",
    conversation: prompt.messages.map(messageForCodex),
  };
}

function canonicalPromptText(prompt: ExtractedPrompt): string {
  return [
    "You are the model backend for jsx-ai. Treat the JSON below as the complete canonical prompt.",
    "Application tools are exposed through Codex native dynamic tools. Use those tools directly when the system or conversation calls for them.",
    "You may invoke multiple independent application tools in the same turn.",
    "If a dynamic tool reports that execution is deferred to the host, treat that as a handoff boundary: do not retry it, do not issue dependent calls whose arguments require its result, and finish this turn without claiming the action completed.",
    "Any local images attached to this turn correspond in order to attachment records in the canonical conversation.",
    "Do not claim a host-side action occurred unless the canonical conversation contains its real tool result.",
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

const DEFERRED_TOOL_RESULT =
  "jsx-ai accepted this native tool request for host execution after the current Codex turn. The real tool result will arrive in the next canonical message. Do not retry this call or make dependent calls in this turn.";

function failedDynamicToolResult(message: string) {
  return {
    success: false,
    contentItems: [{ type: "inputText" as const, text: message }],
  };
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
    prompt,
  );
  try {
    let bridge: CodexBridgeInput;
    if (session.requiresResync) {
      // Native dynamic-tool requests are acknowledged only so Codex can end the
      // current turn; the host executes them after callLLM returns. Start the
      // next canonical step on a clean native thread so the temporary handoff
      // acknowledgment is never mistaken for the real tool result.
      await restartCodexThread(session, model, options, prompt);
      bridge = {
        mode: "resync",
        text: canonicalPromptText(prompt),
        messagesSent: prompt.messages.length,
        attachments: messageAttachments(prompt.messages),
      };
    } else {
      bridge = bridgeInput(session, prompt);
      if (bridge.mode === "resync") {
        // Append-only canonical history is required for safe delta turns. If a
        // caller rewrites history inside one run, start a fresh native thread.
        await restartCodexThread(session, model, options, prompt);
        bridge = {
          mode: "resync",
          text: canonicalPromptText(prompt),
          messagesSent: prompt.messages.length,
          attachments: messageAttachments(prompt.messages),
        };
      }
    }

    const turnNumber = session.turn + 1;
    const declared = new Set(prompt.tools.map((tool) => tool.name));
    const toolCalls: ToolCall[] = [];
    const callsById = new Map<string, ToolCall>();

    const onDynamicToolCall = async (call: CodexDynamicToolCall) => {
      if (call.threadId !== session.thread.id) {
        return failedDynamicToolResult(
          `Dynamic tool call belongs to unexpected thread ${JSON.stringify(call.threadId)}`,
        );
      }
      if (!declared.has(call.tool)) {
        return failedDynamicToolResult(
          `Codex requested undeclared application tool ${JSON.stringify(call.tool)}`,
        );
      }
      if (!isRecord(call.arguments)) {
        return failedDynamicToolResult(
          `Codex dynamic tool ${JSON.stringify(call.tool)} arguments must be a JSON object`,
        );
      }

      const existing = callsById.get(call.callId);
      if (existing) {
        return {
          success: true,
          contentItems: [
            { type: "inputText" as const, text: DEFERRED_TOOL_RESULT },
          ],
        };
      }

      const normalized = normalizeToolCall(
        {
          id: call.callId,
          name: call.tool,
          args: call.arguments as JsonObject,
        },
        call.callId,
        `Codex native dynamic tool ${JSON.stringify(call.tool)}`,
      );
      const index = toolCalls.length;
      toolCalls.push(normalized);
      callsById.set(call.callId, normalized);

      await runtimeContext?.onToolProgress?.({
        type: "tool_detected",
        index,
        name: normalized.name,
      });
      for (const [field, value] of Object.entries(normalized.args)) {
        await runtimeContext?.onToolProgress?.({
          type: "field_ready",
          index,
          name: normalized.name,
          path: [field],
          value,
        });
      }

      return {
        success: true,
        contentItems: [
          { type: "inputText" as const, text: DEFERRED_TOOL_RESULT },
        ],
      };
    };

    const turn = await session.thread.run(codexTurnInput(bridge, options), {
      ...options,
      onProgress: runtimeContext?.onProgress,
      onTextDelta: runtimeContext?.onTextDelta,
      ...(prompt.tools.length ? { onDynamicToolCall } : {}),
    });

    // Once a native tool was requested, any post-acknowledgment prose belongs to
    // the adapter handoff rather than the canonical assistant/tool-call message.
    const text = toolCalls.length ? "" : turn.finalResponse;

    session.turn = turnNumber;
    session.syncedMessages = prompt.messages;
    session.contractKey = promptContractKey(prompt);
    session.lastResponse = { text, toolCalls };
    session.requiresResync = toolCalls.length > 0;

    const dynamicTools = prompt.tools.map(dynamicToolForCodex);
    return {
      text,
      toolCalls,
      raw: {
        runtime: "codex",
        transport: "app-server",
        nativeTools: true,
        threadId: session.thread.id,
        threadTurn: turnNumber,
        bridgeMode: bridge.mode,
        bridgePromptChars: bridge.text.length,
        bridgeMessagesSent: bridge.messagesSent,
        bridgeAttachmentsSent: bridge.attachments.length,
        nativeToolCalls: toolCalls,
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
          nativeTools: true,
          ...(model ? { model } : {}),
          threadId: session.thread.id,
          threadTurn: turnNumber,
          bridgeMode: bridge.mode,
          bridgePromptChars: bridge.text.length,
          bridgeMessagesSent: bridge.messagesSent,
          bridgeMessagesTotal: prompt.messages.length,
          bridgeAttachmentsSent: bridge.attachments.length,
          bridgeAttachmentsTotal: messageAttachments(prompt.messages).length,
          prompt: bridge.text,
          dynamicTools,
        },
        prepared: {
          system: prompt.system,
          messages: prompt.messages,
          nativeTools: prompt.tools,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
        },
      },
      finishReason: toolCalls.length ? "tool_calls" : "completed",
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
