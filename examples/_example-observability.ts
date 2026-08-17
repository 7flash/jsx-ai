import { configure, measure } from "measure-fn";
import type { AgentRuntimeProgress, LLMResponse, ToolCall } from "../src";

configure({
  timestamps: true,
  maxResultLength: 420,
  dotEndLabel: false,
});

export { measure };
export type { MeasureFn } from "measure-fn";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createRuntimeProgressReporter(): (
  progress: AgentRuntimeProgress,
  step: number,
) => void {
  let lastKey = "";
  return (progress, step) => {
    const key = `${step}:${progress.kind}:${progress.itemType ?? ""}:${progress.message}`;
    if (key === lastKey) return;
    lastKey = key;
    const elapsed =
      progress.elapsedMs < 1000
        ? `${Math.max(0, Math.round(progress.elapsedMs))}ms`
        : `${(progress.elapsedMs / 1000).toFixed(1)}s`;
    const marker = progress.kind === "warning" ? "!" : "↳";
    console.log(
      `    ${marker} [${progress.runtime}:${progress.kind} +${elapsed}] ${progress.message}`,
    );
  };
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

export function usageSnapshot(usage: LLMResponse["usage"]): UsageSnapshot {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const thinkingTokens = usage?.thinkingTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens: inputTokens + outputTokens + thinkingTokens,
  };
}

export function summarizeToolCall(call: ToolCall): Record<string, unknown> {
  const args = call.args;
  const summary: Record<string, unknown> = { tool: call.name };

  if (typeof args.path === "string") summary.path = args.path;
  if (typeof args.command === "string")
    summary.command = truncate(args.command, 120);
  if (typeof args.query === "string") summary.query = truncate(args.query, 120);
  if (typeof args.summary === "string")
    summary.summary = truncate(args.summary, 140);
  if (typeof args.content === "string")
    summary.contentChars = args.content.length;
  if (typeof args.search === "string") summary.searchChars = args.search.length;
  if (typeof args.replace === "string")
    summary.replaceChars = args.replace.length;

  const represented = new Set([
    "path",
    "command",
    "query",
    "summary",
    "content",
    "search",
    "replace",
  ]);
  const remaining = Object.keys(args).filter((key) => !represented.has(key));
  if (remaining.length) summary.otherArgs = remaining;

  return summary;
}

export function summarizeResponse(
  response: LLMResponse,
): Record<string, unknown> {
  const usage = usageSnapshot(response.usage);
  const runtime = response.request?.url?.startsWith("codex://")
    ? "codex"
    : "api";
  const body = response.request?.body;
  const requestModel = body?.model;
  const raw = record(response.raw);
  const rawUsage = record(raw?.usage);
  const rawStream = record(raw?.stream);
  const codexBridge =
    runtime === "codex"
      ? {
          threadTurn:
            typeof body?.threadTurn === "number" ? body.threadTurn : undefined,
          bridgeMode:
            typeof body?.bridgeMode === "string" ? body.bridgeMode : undefined,
          promptChars:
            typeof body?.bridgePromptChars === "number"
              ? body.bridgePromptChars
              : undefined,
          messagesSent:
            typeof body?.bridgeMessagesSent === "number"
              ? body.bridgeMessagesSent
              : undefined,
          messagesTotal:
            typeof body?.bridgeMessagesTotal === "number"
              ? body.bridgeMessagesTotal
              : undefined,
          cachedInputTokens:
            typeof rawUsage?.cachedInputTokens === "number"
              ? rawUsage.cachedInputTokens
              : undefined,
          cacheWriteInputTokens:
            typeof rawUsage?.cacheWriteInputTokens === "number"
              ? rawUsage.cacheWriteInputTokens
              : undefined,
          streamEvents:
            typeof rawStream?.events === "number"
              ? rawStream.events
              : undefined,
          streamProgressEvents:
            typeof rawStream?.progressEvents === "number"
              ? rawStream.progressEvents
              : undefined,
          timeToFirstEventMs:
            typeof rawStream?.firstEventMs === "number"
              ? rawStream.firstEventMs
              : undefined,
          timeToFirstStatusMs:
            typeof rawStream?.firstStatusMs === "number"
              ? rawStream.firstStatusMs
              : undefined,
        }
      : undefined;
  return {
    runtime,
    model:
      typeof requestModel === "string"
        ? requestModel
        : runtime === "codex"
          ? "Codex config"
          : "provider request",
    ...(codexBridge ? { bridge: codexBridge } : {}),
    finishReason: response.finishReason ?? "unknown",
    tools: response.toolCalls.map(summarizeToolCall),
    text: response.text ? truncate(response.text, 220) : "",
    tokens: usage,
  };
}

export function printResponseDetails(response: LLMResponse): void {
  const usage = usageSnapshot(response.usage);
  if (response.text.trim()) {
    console.log("\nAssistant text:");
    console.log(response.text.trim());
  }

  if (response.toolCalls.length) {
    console.log("\nTool calls:");
    for (const call of response.toolCalls) {
      console.log(`  - ${JSON.stringify(summarizeToolCall(call))}`);
    }
  }

  console.log(
    `\nTokens: ${usage.inputTokens} input + ${usage.outputTokens} output` +
      (usage.thinkingTokens ? ` + ${usage.thinkingTokens} thinking` : "") +
      ` = ${usage.totalTokens} total`,
  );
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
