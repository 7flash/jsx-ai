import type { ExtractedMessage, ToolCall } from "./types";

export function formatToolCall(call: ToolCall): string {
  const id = call.id ? ` id=${JSON.stringify(call.id)}` : "";
  return `[tool_call${id} name=${JSON.stringify(call.name)}]\n${JSON.stringify(call.args, null, 2)}\n[/tool_call]`;
}

export function formatMessageForTextProtocol(
  message: ExtractedMessage,
): string {
  if (message.role === "tool") {
    const id = message.toolCallId
      ? ` id=${JSON.stringify(message.toolCallId)}`
      : "";
    const name = message.toolName
      ? ` name=${JSON.stringify(message.toolName)}`
      : "";
    const error = message.isError ? ` error=true` : "";
    return `[tool_result${id}${name}${error}]\n${message.content}\n[/tool_result]`;
  }

  const calls = message.toolCalls?.map(formatToolCall).join("\n") || "";
  if (!calls) return message.content;
  return [message.content, calls].filter(Boolean).join("\n\n");
}

/** Convert canonical tool history into ordinary user/assistant text for text-only protocols. */
export function textProtocolMessages(
  messages: readonly ExtractedMessage[],
): ExtractedMessage[] {
  return messages.map((message) => ({
    role: message.role === "tool" ? "user" : message.role,
    content: formatMessageForTextProtocol(message),
  }));
}
