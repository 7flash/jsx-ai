/**
 * Runtime-neutral progress emitted while a model call is still running.
 *
 * This is intentionally small: runtimes translate their native event streams
 * into status/activity/warning messages instead of leaking provider SDK event
 * types into runAgent's public API.
 */
export interface RuntimeProgress {
  runtime: string;
  kind: "status" | "activity" | "warning";
  message: string;
  /** Runtime-native item category after normalization, when useful for UI grouping. */
  itemType?: string;
  /** Milliseconds since the current runtime turn started. */
  elapsedMs: number;
}

/**
 * Private per-run execution state.
 *
 * runAgent attaches this to call options with a symbol so stateful runtimes can
 * reuse native conversation/process objects without adding session concepts to
 * the public agent API. API runtimes ignore it.
 */
export interface AgentRuntimeContext {
  codex?: unknown;
  onProgress?: (progress: RuntimeProgress) => void | Promise<void>;
  /** Visible assistant text decoded from an in-flight structured runtime turn. */
  onTextDelta?: (delta: string) => void | Promise<void>;
  cleanups: Array<() => void | Promise<void>>;
}

export const AGENT_RUNTIME_CONTEXT = Symbol.for("jsx-ai.agent-runtime-context");

export type AgentRuntimeCarrier = {
  [AGENT_RUNTIME_CONTEXT]?: AgentRuntimeContext;
};

export function createAgentRuntimeContext(): AgentRuntimeContext {
  return { cleanups: [] };
}

export function addAgentRuntimeCleanup(
  context: AgentRuntimeContext | undefined,
  cleanup: () => void | Promise<void>,
): void {
  context?.cleanups.push(cleanup);
}

export async function disposeAgentRuntimeContext(
  context: AgentRuntimeContext,
): Promise<void> {
  const cleanups = context.cleanups.splice(0).reverse();
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      // Runtime cleanup is best-effort. A shutdown failure must not replace
      // the agent result or the model/tool error that caused the run to end.
    }
  }
  context.codex = undefined;
  context.onProgress = undefined;
  context.onTextDelta = undefined;
}
