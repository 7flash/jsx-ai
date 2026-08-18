import { callLLM } from "./llm";
import { errorMessage } from "./internal/errors";
import {
  AGENT_RUNTIME_CONTEXT,
  createAgentRuntimeContext,
  disposeAgentRuntimeContext,
} from "./internal/agent-runtime";
import type {
  RuntimeProgress,
  RuntimeToolProgress,
} from "./internal/agent-runtime";
import {
  normalizeMessageAttachments,
  normalizePromptIR,
  normalizeToolCall,
} from "./ir";
import type { CallOptions } from "./llm";
import type {
  CanonicalToolCall,
  ExtractedMessage,
  JsonValue,
  JsxAiNode,
  LLMResponse,
  MessageAttachment,
  ToolCall,
} from "./types";

export type AgentStopReason =
  | "completed"
  | "no_tool_calls"
  | "max_steps"
  | "max_tool_calls"
  | "max_input_tokens"
  | "max_output_tokens"
  | "max_duration"
  | "aborted";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface AgentToolResult {
  /** Text observation returned to the model. Use an empty string for image-only results. */
  content: string;
  /** Local attachments the model should perceive on its next turn. */
  attachments?: readonly MessageAttachment[];
  isError?: boolean;
}

export type AgentToolExecutorResult =
  AgentToolResult | ExtractedMessage | string;

export interface AgentContext<State = unknown> {
  /** Zero-based model step about to run, or that just ran for callbacks. */
  step: number;
  history: readonly ExtractedMessage[];
  usage: Readonly<AgentUsage>;
  toolCallsExecuted: number;
  elapsedMs: number;
  /** Effective cancellation signal, including caller cancellation and maxDurationMs. */
  signal?: AbortSignal;
  state: State;
}

export interface AgentStep {
  index: number;
  response: LLMResponse;
  toolResults: ExtractedMessage[];
  durationMs: number;
}

export type AgentRuntimeProgress = RuntimeProgress;

/** User-visible assistant text emitted while the current model step is still running. */
export interface AgentTextDelta {
  delta: string;
  /** Zero-based model step producing this text. */
  step: number;
  /** Milliseconds since this runAgent invocation started. */
  elapsedMs: number;
}

/** Semantic progress while the model is constructing a structured host-tool call. */
export type AgentToolProgress =
  | {
      type: "tool_detected";
      step: number;
      index: number;
      name: string;
      elapsedMs: number;
    }
  | {
      type: "field_delta";
      step: number;
      index: number;
      /** May be absent only when a runtime streams arguments before the tool name. */
      name?: string;
      /** Argument path. Progressive deltas currently target string fields. */
      path: readonly string[];
      delta: string;
      elapsedMs: number;
    }
  | {
      type: "field_ready";
      step: number;
      index: number;
      /** May be absent only when a runtime streams arguments before the tool name. */
      name?: string;
      /** Argument path whose JSON value is now syntactically complete. */
      path: readonly string[];
      value: JsonValue;
      elapsedMs: number;
    }
  | {
      type: "tool_ready";
      step: number;
      index: number;
      /** Complete canonical call. This is still generation progress, not execution. */
      call: CanonicalToolCall;
      elapsedMs: number;
    };

export type AgentEvent<State = unknown> =
  | { type: "model_start"; context: AgentContext<State> }
  | {
      type: "runtime_progress";
      context: AgentContext<State>;
      progress: AgentRuntimeProgress;
    }
  | { type: "text_delta"; context: AgentContext<State>; delta: string }
  | {
      type: "tool_progress";
      context: AgentContext<State>;
      progress: AgentToolProgress;
    }
  | { type: "model_end"; context: AgentContext<State>; response: LLMResponse }
  | {
      type: "tool_start";
      context: AgentContext<State>;
      call: CanonicalToolCall;
    }
  | {
      type: "tool_end";
      context: AgentContext<State>;
      call: CanonicalToolCall;
      result: ExtractedMessage;
    }
  | { type: "stop"; context: AgentContext<State>; reason: AgentStopReason };

export interface AgentRunResult<State = unknown> {
  reason: AgentStopReason;
  history: ExtractedMessage[];
  steps: AgentStep[];
  usage: AgentUsage;
  toolCallsExecuted: number;
  elapsedMs: number;
  /** Effective cancellation signal, including caller cancellation and maxDurationMs. */
  signal?: AbortSignal;
  state: State;
}

export interface AgentRunOptions<State = undefined> {
  /** Existing canonical history. The array is copied; the caller's input is not mutated. */
  history?: readonly ExtractedMessage[];
  /** Build the JSX prompt for each model step from canonical history. */
  buildPrompt: (
    history: readonly ExtractedMessage[],
    context: AgentContext<State>,
  ) => JsxAiNode;
  /** Execute one requested tool and return its canonical result payload. */
  executeTool: (
    call: CanonicalToolCall,
    context: AgentContext<State>,
  ) => AgentToolExecutorResult | Promise<AgentToolExecutorResult>;
  /** Options passed through to callLLM on each step. */
  callOptions?: CallOptions;
  /** Dependency injection for tests/custom runtimes. Defaults to callLLM. */
  call?: typeof callLLM;
  /** Caller-owned mutable state exposed to callbacks/tool executors. */
  state?: State;
  /** Default: 12 model steps. */
  maxSteps?: number;
  /** Default: 64 successfully dispatched tool calls. Batches are atomic against this budget. */
  maxToolCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** Overall wall-clock budget for the run. Checked between model/tool operations. */
  maxDurationMs?: number;
  /** Execute a model's tool-call batch concurrently. Default false for deterministic side effects. */
  parallelToolCalls?: boolean;
  /** External cancellation signal. */
  signal?: AbortSignal;
  /** Called after a tool batch is appended. Return true when the run is complete. */
  isComplete?: (
    response: LLMResponse,
    toolResults: readonly ExtractedMessage[],
    context: AgentContext<State>,
  ) => boolean | Promise<boolean>;
  /**
   * Recovery policy for a model turn with no tool calls.
   * Return a string to append as a user message and continue; otherwise the run stops.
   */
  onNoToolCalls?: (
    response: LLMResponse,
    context: AgentContext<State>,
  ) => string | undefined | false | Promise<string | undefined | false>;
  /**
   * Stream user-visible assistant words while a model step is running.
   * Structured tool-call data remains buffered and is only exposed after validation.
   * Runtimes without structured text-delta support may emit the final text once.
   */
  onTextDelta?: (
    event: AgentTextDelta,
    context: AgentContext<State>,
  ) => void | Promise<void>;
  /**
   * Observe a tool call while the model is constructing it. This callback is
   * UI/telemetry only: executeTool is never called until the complete turn has
   * returned and the canonical tool call is ready.
   */
  onToolProgress?: (
    event: AgentToolProgress,
    context: AgentContext<State>,
  ) => void | Promise<void>;
  /**
   * Ordered agent event stream. Includes text_delta and tool_progress in the same
   * chronology as model/tool lifecycle events, which is convenient for SSE/WebSocket UIs.
   * Event callbacks are awaited; slow handlers intentionally apply backpressure.
   */
  onEvent?: (event: AgentEvent<State>) => void | Promise<void>;
}

function usageFrom(result: LLMResponse): AgentUsage {
  return {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    thinkingTokens: result.usage?.thinkingTokens ?? 0,
  };
}

function addUsage(total: AgentUsage, next: AgentUsage): void {
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.thinkingTokens += next.thinkingTokens;
}

function normalizeCalls(
  calls: readonly ToolCall[],
  step: number,
): CanonicalToolCall[] {
  return calls.map((call, index) =>
    normalizeToolCall(
      call,
      `jsx_ai_${step}_${index}_${call.name}`,
      `agent step ${step} toolCalls[${index}]`,
    ),
  );
}

function fieldProgressKey(index: number, path: readonly string[]): string {
  return `${index}:${JSON.stringify(path)}`;
}

function normalizeToolResult(
  call: CanonicalToolCall,
  value: AgentToolExecutorResult,
): ExtractedMessage {
  if (typeof value === "string") {
    return Object.freeze({
      role: "tool",
      content: value,
      toolCallId: call.id,
      toolName: call.name,
    });
  }

  if ("role" in value) {
    if (value.role !== "tool")
      throw new Error(
        `Tool executor for ${call.name} returned a non-tool message`,
      );
    if (value.toolCallId !== call.id) {
      throw new Error(
        `Tool executor for ${call.name} returned toolCallId ${JSON.stringify(value.toolCallId)}; expected ${JSON.stringify(call.id)}`,
      );
    }
    if (value.toolName !== call.name) {
      throw new Error(
        `Tool executor for ${call.name} returned toolName ${JSON.stringify(value.toolName)}; expected ${JSON.stringify(call.name)}`,
      );
    }
    const attachments = normalizeMessageAttachments(
      value.attachments,
      `Tool executor for ${call.name} attachments`,
    );
    return Object.freeze({
      ...value,
      ...(attachments?.length ? { attachments } : {}),
    });
  }

  const content = value.content;
  const attachments = normalizeMessageAttachments(
    value.attachments,
    `Tool executor for ${call.name} attachments`,
  );
  return Object.freeze({
    role: "tool",
    content,
    toolCallId: call.id,
    toolName: call.name,
    ...(value.isError ? { isError: true } : {}),
    ...(attachments?.length ? { attachments } : {}),
  });
}

function finiteLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < 0)
    throw new Error(
      `${name} must be a finite non-negative number; received ${value}`,
    );
  return value;
}

function combineSignals(
  first?: AbortSignal,
  second?: AbortSignal,
): AbortSignal | undefined {
  if (!first) return second;
  if (!second || first === second) return first;
  return AbortSignal.any([first, second]);
}

function budgetLimit(value: number | undefined): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  if (Number.isNaN(value) || value < 0)
    throw new Error(
      `Agent budget must be a non-negative number; received ${value}`,
    );
  return value;
}

/**
 * Execute the canonical model → tool → tool-result loop.
 *
 * This runtime deliberately does not own tool definitions or project state. The caller
 * still builds the JSX prompt and executes tools; runAgent only centralizes history,
 * IDs, budgets, cancellation, and loop termination.
 */
export async function runAgent<State = undefined>(
  options: AgentRunOptions<State>,
): Promise<AgentRunResult<State>> {
  const history = [
    ...normalizePromptIR({ tools: [], messages: options.history ?? [] })
      .messages,
  ];
  const steps: AgentStep[] = [];
  const usage: AgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };
  const state = options.state as State;
  const startedAt = Date.now();
  const maxSteps = finiteLimit(options.maxSteps, 12, "maxSteps");
  const maxToolCalls = finiteLimit(options.maxToolCalls, 64, "maxToolCalls");
  const maxInputTokens = budgetLimit(options.maxInputTokens);
  const maxOutputTokens = budgetLimit(options.maxOutputTokens);
  const maxDurationMs = budgetLimit(options.maxDurationMs);
  const invoke = options.call ?? callLLM;
  const runtimeContext = createAgentRuntimeContext();
  const externalSignal = combineSignals(
    options.signal,
    options.callOptions?.signal,
  );
  const deadlineSignal = Number.isFinite(maxDurationMs)
    ? AbortSignal.timeout(maxDurationMs)
    : undefined;
  const operationSignal = combineSignals(externalSignal, deadlineSignal);
  let toolCallsExecuted = 0;

  const context = (step: number): AgentContext<State> => ({
    step,
    history: [...history],
    usage: { ...usage },
    toolCallsExecuted,
    elapsedMs: Date.now() - startedAt,
    ...(operationSignal ? { signal: operationSignal } : {}),
    state,
  });

  const budgetStopReason = (): AgentStopReason | undefined => {
    if (externalSignal?.aborted) return "aborted";
    if (deadlineSignal?.aborted || Date.now() - startedAt >= maxDurationMs)
      return "max_duration";
    if (usage.inputTokens >= maxInputTokens) return "max_input_tokens";
    if (usage.outputTokens >= maxOutputTokens) return "max_output_tokens";
    return undefined;
  };

  const emit = async (event: AgentEvent<State>) => {
    await options.onEvent?.(event);
  };

  const finish = async (
    reason: AgentStopReason,
    step: number,
  ): Promise<AgentRunResult<State>> => {
    await emit({ type: "stop", context: context(step), reason });
    return {
      reason,
      history,
      steps,
      usage: { ...usage },
      toolCallsExecuted,
      elapsedMs: Date.now() - startedAt,
      state,
    };
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      const preStepStop = budgetStopReason();
      if (preStepStop) return finish(preStepStop, step);

      await emit({ type: "model_start", context: context(step) });
      const stepStartedAt = Date.now();
      let rawResponse: LLMResponse;
      let streamedText = "";
      const detectedTools = new Map<number, string>();
      const readyFields = new Set<string>();

      const emitTextDelta = async (delta: string) => {
        if (!delta) return;
        streamedText += delta;
        const textDelta: AgentTextDelta = {
          delta,
          step,
          elapsedMs: Date.now() - startedAt,
        };
        const eventContext = context(step);
        await emit({ type: "text_delta", context: eventContext, delta });
        await options.onTextDelta?.(textDelta, eventContext);
      };

      const emitAgentToolProgress = async (progress: AgentToolProgress) => {
        const eventContext = context(step);
        await emit({ type: "tool_progress", context: eventContext, progress });
        await options.onToolProgress?.(progress, eventContext);
      };

      const emitToolProgress = async (progress: RuntimeToolProgress) => {
        if (progress.type === "tool_detected")
          detectedTools.set(progress.index, progress.name);
        if (progress.type === "field_ready")
          readyFields.add(fieldProgressKey(progress.index, progress.path));
        await emitAgentToolProgress({
          ...progress,
          step,
          elapsedMs: Date.now() - startedAt,
        });
      };

      try {
        // `maxDurationMs` is the budget for the whole agent run, not a model-call
        // timeout. The combined signal enforces that deadline. Per-call timeout
        // policy remains owned by callLLM/the selected runtime (or an explicit
        // callOptions.timeoutMs override).
        runtimeContext.onProgress = (progress) =>
          emit({
            type: "runtime_progress",
            context: context(step),
            progress,
          });
        runtimeContext.onTextDelta =
          options.onTextDelta || options.onEvent ? emitTextDelta : undefined;
        runtimeContext.onToolProgress =
          options.onToolProgress || options.onEvent
            ? emitToolProgress
            : undefined;
        const callOptions = {
          ...options.callOptions,
          signal: operationSignal,
          [AGENT_RUNTIME_CONTEXT]: runtimeContext,
        };
        rawResponse = await invoke(
          options.buildPrompt(history, context(step)),
          callOptions,
        );
      } catch (error) {
        if (externalSignal?.aborted) return finish("aborted", step);
        if (deadlineSignal?.aborted || Date.now() - startedAt >= maxDurationMs)
          return finish("max_duration", step);
        throw error;
      }

      const calls = normalizeCalls(rawResponse.toolCalls, step);
      const response: LLMResponse = { ...rawResponse, toolCalls: calls };

      // Preserve one simple UI contract across runtimes. Codex streams decoded
      // structured text during the turn; runtimes that do not yet expose
      // structured text deltas fall back to one final visible text chunk.
      if (
        (options.onTextDelta || options.onEvent) &&
        response.text &&
        !streamedText
      ) {
        await emitTextDelta(response.text);
      } else if (
        (options.onTextDelta || options.onEvent) &&
        response.text &&
        streamedText &&
        response.text.startsWith(streamedText) &&
        response.text.length > streamedText.length
      ) {
        await emitTextDelta(response.text.slice(streamedText.length));
      }

      if (options.onToolProgress || options.onEvent) {
        for (const [index, call] of calls.entries()) {
          if (detectedTools.get(index) !== call.name) {
            await emitAgentToolProgress({
              type: "tool_detected",
              step,
              index,
              name: call.name,
              elapsedMs: Date.now() - startedAt,
            });
          }

          for (const [field, value] of Object.entries(call.args)) {
            const path = [field] as const;
            if (!readyFields.has(fieldProgressKey(index, path))) {
              await emitAgentToolProgress({
                type: "field_ready",
                step,
                index,
                name: call.name,
                path,
                value,
                elapsedMs: Date.now() - startedAt,
              });
            }
          }

          await emitAgentToolProgress({
            type: "tool_ready",
            step,
            index,
            call,
            elapsedMs: Date.now() - startedAt,
          });
        }
      }

      addUsage(usage, usageFrom(response));
      history.push(
        Object.freeze({
          role: "assistant",
          content: response.text,
          toolCalls: Object.freeze(calls),
        }),
      );
      await emit({ type: "model_end", context: context(step), response });

      if (!calls.length) {
        const recovery = await options.onNoToolCalls?.(response, context(step));
        steps.push({
          index: step,
          response,
          toolResults: [],
          durationMs: Date.now() - stepStartedAt,
        });
        if (typeof recovery === "string" && recovery.trim()) {
          history.push(Object.freeze({ role: "user", content: recovery }));
          continue;
        }
        return finish("no_tool_calls", step);
      }

      // Avoid partially executing a parallel/ordered batch when the tool budget cannot cover it.
      // Still append explicit error results so canonical native history never ends with orphaned calls.
      if (toolCallsExecuted + calls.length > maxToolCalls) {
        const skippedResults = calls.map((call) =>
          normalizeToolResult(call, {
            content:
              "Tool call was not executed because the agent tool-call budget was exhausted.",
            isError: true,
          }),
        );
        history.push(...skippedResults);
        steps.push({
          index: step,
          response,
          toolResults: skippedResults,
          durationMs: Date.now() - stepStartedAt,
        });
        return finish("max_tool_calls", step);
      }

      const executeOne = async (
        call: CanonicalToolCall,
      ): Promise<ExtractedMessage> => {
        if (operationSignal?.aborted) {
          return normalizeToolResult(call, {
            content: "Agent run aborted before tool execution.",
            isError: true,
          });
        }
        await emit({ type: "tool_start", context: context(step), call });
        let result: ExtractedMessage;
        try {
          result = normalizeToolResult(
            call,
            await options.executeTool(call, context(step)),
          );
        } catch (error) {
          result = normalizeToolResult(call, {
            content: errorMessage(error),
            isError: true,
          });
        }
        toolCallsExecuted++;
        await emit({ type: "tool_end", context: context(step), call, result });
        return result;
      };

      let toolResults: ExtractedMessage[];
      if (options.parallelToolCalls) {
        toolResults = await Promise.all(calls.map(executeOne));
      } else {
        toolResults = [];
        for (const call of calls) toolResults.push(await executeOne(call));
      }

      history.push(...toolResults);
      steps.push({
        index: step,
        response,
        toolResults,
        durationMs: Date.now() - stepStartedAt,
      });

      if (await options.isComplete?.(response, toolResults, context(step))) {
        return finish("completed", step);
      }
      const postStepStop = budgetStopReason();
      if (postStepStop) return finish(postStepStop, step);
    }

    return finish("max_steps", maxSteps);
  } finally {
    await disposeAgentRuntimeContext(runtimeContext);
  }
}
