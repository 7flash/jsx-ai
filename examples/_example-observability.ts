import { configure, measure, type MeasureFn } from "measure-fn";
import { callLLM } from "../src";
import type {
  AgentRunResult,
  AgentRuntimeProgress,
  AgentToolExecutorResult,
  CanonicalToolCall,
  LLMResponse,
  ToolCall,
} from "../src";

configure({
  timestamps: true,
  maxResultLength: 420,
  dotEndLabel: false,
});

export { measure };
export type { MeasureFn };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function elapsedLabel(elapsedMs: number): string {
  return elapsedMs < 1000
    ? `${Math.max(0, Math.round(elapsedMs))}ms`
    : `${(elapsedMs / 1000).toFixed(1)}s`;
}

export function formatRuntimeProgress(
  progress: AgentRuntimeProgress,
  step: number,
): string {
  const marker = progress.kind === "warning" ? "!" : "↳";
  return `    ${marker} [step ${step} · ${progress.runtime}:${progress.kind} +${elapsedLabel(progress.elapsedMs)}] ${progress.message}`;
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
    console.log(formatRuntimeProgress(progress, step));
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

export function summarizeToolResult(
  result: AgentToolExecutorResult,
): Record<string, unknown> {
  if (typeof result === "string") {
    return {
      resultChars: result.length,
      preview: truncate(result.replace(/\s+/g, " "), 180),
    };
  }

  const value = record(result) ?? {};
  const content = typeof value.content === "string" ? value.content : "";
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map((attachment) => record(attachment)?.path)
        .filter((path): path is string => typeof path === "string")
    : [];

  return compactRecord({
    role: typeof value.role === "string" ? value.role : undefined,
    tool: typeof value.toolName === "string" ? value.toolName : undefined,
    error: typeof value.isError === "boolean" ? value.isError : false,
    resultChars: content.length,
    attachments: attachments.length ? attachments : undefined,
    preview: content ? truncate(content.replace(/\s+/g, " "), 180) : "",
  });
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
      ? compactRecord({
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
        })
      : undefined;
  return {
    runtime,
    model:
      typeof requestModel === "string"
        ? requestModel
        : runtime === "codex"
          ? "Codex config"
          : "provider request",
    ...(codexBridge && Object.keys(codexBridge).length
      ? { bridge: codexBridge }
      : {}),
    finishReason: response.finishReason ?? "unknown",
    tools: response.toolCalls.map(summarizeToolCall),
    text: response.text ? truncate(response.text, 220) : "",
    tokens: usage,
  };
}

type CallOptions = Parameters<typeof callLLM>[1];

export interface MeasuredLLMCallOptions {
  /** Stable trace label. Step number is emitted separately as structured metadata. */
  label?: string;
  /** Optional call override for runtime-specific defaults or tests. */
  call?: typeof callLLM;
  /** Additional per-step metadata kept out of the label for easier filtering. */
  metadata?: (
    step: number,
    options: CallOptions,
  ) => Record<string, unknown> | undefined;
}

export function createMeasuredLLMCall(
  trace: MeasureFn,
  options: MeasuredLLMCallOptions = {},
): typeof callLLM {
  let step = 0;
  const invoke = options.call ?? callLLM;

  return async (tree, callOptions) => {
    const current = ++step;
    const response = await trace(
      {
        label: options.label ?? "Model step",
        step: current,
        ...(callOptions?.strategy ? { strategy: callOptions.strategy } : {}),
        ...(callOptions?.model ? { model: callOptions.model } : {}),
        ...(options.metadata?.(current, callOptions) ?? {}),
        result: summarizeResponse,
      },
      () => invoke(tree, callOptions),
    );

    if (response === null) {
      throw new Error(
        `Model step ${current} failed; inspect the measure-fn trace.`,
      );
    }
    return response;
  };
}

export interface MeasuredToolOptions<Result, Args extends unknown[] = []> {
  /** Stable trace label. Tool name is emitted separately as structured metadata. */
  label?: string;
  summarize?: (result: Result) => Record<string, unknown>;
  metadata?: (
    call: CanonicalToolCall,
    ...args: Args
  ) => Record<string, unknown> | undefined;
}

export function createMeasuredToolExecutor<Result, Args extends unknown[] = []>(
  trace: MeasureFn,
  execute: (call: CanonicalToolCall, ...args: Args) => Result | Promise<Result>,
  options: MeasuredToolOptions<Result, Args> = {},
): (call: CanonicalToolCall, ...args: Args) => Promise<Result> {
  return async (call, ...args) => {
    const result = await trace(
      {
        label: options.label ?? "Host tool",
        ...summarizeToolCall(call),
        ...(options.metadata?.(call, ...args) ?? {}),
        result:
          options.summarize ??
          ((value: Result) =>
            summarizeToolResult(value as unknown as AgentToolExecutorResult)),
      },
      () => execute(call, ...args),
    );

    if (result === null) {
      throw new Error(
        `Host tool ${call.name} failed; inspect the measure-fn trace.`,
      );
    }
    return result;
  };
}

export function summarizeAgentRun<State>(
  result: AgentRunResult<State>,
  summarizeState?: (state: State) => Record<string, unknown>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    elapsedMs: result.elapsedMs,
    tokens: result.usage,
    ...(summarizeState ? summarizeState(result.state) : {}),
  };
}

export interface MeasuredAgentOptions<State> {
  /** Stable root/child label for the complete agent run. */
  label: string;
  /** Structured metadata attached to the agent span. */
  metadata?: Record<string, unknown>;
  /** Optional model-step measurement customization. */
  llm?: MeasuredLLMCallOptions;
  /** Domain-specific state fields appended to the common agent summary. */
  summarizeState?: (state: State) => Record<string, unknown>;
  /** Full result override for examples that need step-level derived metrics. */
  summarizeResult?: (result: AgentRunResult<State>) => Record<string, unknown>;
}

export interface MeasuredAgentScope {
  /** Child trace for additional domain-specific measurements. */
  trace: MeasureFn;
  /** Measured callLLM-compatible function with structured step metadata. */
  call: typeof callLLM;
  /** De-duplicated console reporter for runtime progress events. */
  reportRuntimeProgress: ReturnType<typeof createRuntimeProgressReporter>;
  /** Wrap a host-tool implementation in the same trace hierarchy. */
  measureTool<Result, Args extends unknown[] = []>(
    execute: (
      call: CanonicalToolCall,
      ...args: Args
    ) => Result | Promise<Result>,
    options?: MeasuredToolOptions<Result, Args>,
  ): (call: CanonicalToolCall, ...args: Args) => Promise<Result>;
}

function agentMeasureDefinition<State>(options: MeasuredAgentOptions<State>) {
  return {
    ...(options.metadata ?? {}),
    label: options.label,
    result:
      options.summarizeResult ??
      ((result: AgentRunResult<State>) =>
        summarizeAgentRun(result, options.summarizeState)),
  };
}

function createMeasuredAgentScope(
  trace: MeasureFn,
  llm?: MeasuredLLMCallOptions,
): MeasuredAgentScope {
  function measureTool<Result, Args extends unknown[] = []>(
    execute: (
      call: CanonicalToolCall,
      ...args: Args
    ) => Result | Promise<Result>,
    options?: MeasuredToolOptions<Result, Args>,
  ): (call: CanonicalToolCall, ...args: Args) => Promise<Result> {
    return createMeasuredToolExecutor(trace, execute, options);
  }

  return {
    trace,
    call: createMeasuredLLMCall(trace, llm),
    reportRuntimeProgress: createRuntimeProgressReporter(),
    measureTool,
  };
}

/**
 * Measure one complete agent run as a fail-fast root span.
 *
 * Examples own domain behavior; this helper owns the observability contract:
 * one agent span, measured model steps, measured host tools, and common summaries.
 */
export async function measureAgent<State>(
  options: MeasuredAgentOptions<State>,
  run: (scope: MeasuredAgentScope) => Promise<AgentRunResult<State>>,
): Promise<AgentRunResult<State>> {
  return measure.assert(
    agentMeasureDefinition(options),
    async (trace: MeasureFn) =>
      run(createMeasuredAgentScope(trace, options.llm)),
  );
}

/** Measure an agent as a child span inside a larger measured workflow. */
export async function traceAgent<State>(
  parent: MeasureFn,
  options: MeasuredAgentOptions<State>,
  run: (scope: MeasuredAgentScope) => Promise<AgentRunResult<State>>,
): Promise<AgentRunResult<State>> {
  const result = await parent(
    agentMeasureDefinition(options),
    async (trace: MeasureFn) =>
      run(createMeasuredAgentScope(trace, options.llm)),
  );
  if (result === null) {
    throw new Error(`${options.label} failed; inspect the measure-fn trace.`);
  }
  return result;
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
