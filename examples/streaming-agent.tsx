#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * The common agent UI pattern in jsx-ai:
 *
 *   onTextDelta  → append real assistant words to the UI as they arrive
 *   tool_start   → show what the agent is doing
 *   tool_end     → clear/update that activity
 *   stop         → finalize the UI
 *
 * Tool-call JSON stays buffered and validated inside jsx-ai. Applications never
 * need to parse partial tool arguments just to show a typing/progress experience.
 */

import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
  LLMResponse,
} from "../src/index";
import {
  measure,
  summarizeResponse,
  summarizeToolCall,
  truncate,
  type MeasureFn,
} from "./_example-observability";

interface DemoState {
  contextRead: boolean;
  completed?: string;
}

const DemoTools = () => (
  <>
    <tool
      name="get_context"
      description="Read the application-owned context needed for the task"
    />
    <tool
      name="finish"
      description="Finish after get_context has been used and the recommendation is ready"
    >
      <param name="summary" type="string" required>
        One concise final recommendation
      </param>
    </tool>
  </>
);

function Conversation({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <>
      {history.map((message) => (
        <message
          role={message.role}
          toolCalls={message.toolCalls}
          toolCallId={message.toolCallId}
          toolName={message.toolName}
          isError={message.isError}
        >
          {message.content}
        </message>
      ))}
    </>
  );
}

function DemoPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt strategy="hybrid">
      <system>{md`
        You are demonstrating a practical streamed agent UI.

        Briefly explain what you are about to do in normal assistant text,
        then call get_context. After seeing its result, briefly explain your
        recommendation and call finish. Keep visible text concise.
      `}</system>
      <DemoTools />
      <Conversation history={history} />
    </prompt>
  );
}

function executeTool(
  call: CanonicalToolCall,
  state: DemoState,
): AgentToolResult {
  if (call.name === "get_context") {
    state.contextRead = true;
    return {
      content: JSON.stringify({
        product: "jsx-ai",
        goal: "Show real assistant words while structured agent tools remain safe and atomic",
        constraint: "The UI must never parse partial tool-call JSON",
      }),
    };
  }

  if (call.name === "finish") {
    if (!state.contextRead)
      return {
        content: "finish rejected: call get_context first",
        isError: true,
      };
    const summary = String(call.args.summary ?? "").trim();
    if (!summary) return { content: "finish requires summary", isError: true };
    state.completed = summary;
    return { content: `Accepted: ${summary}` };
  }

  return { content: `Unknown tool: ${call.name}`, isError: true };
}

function summarizeToolResult(result: AgentToolResult): Record<string, unknown> {
  return {
    error: result.isError ?? false,
    resultChars: result.content.length,
    preview: truncate(result.content.replace(/\s+/g, " "), 160),
  };
}

function summarizeRun(
  result: AgentRunResult<DemoState>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
    completed: result.state.completed ?? "",
  };
}

console.log(`jsx-ai streamed agent UI

The application uses one agent call and two simple surfaces:
  onTextDelta  → append assistant words immediately
  onEvent      → render tool lifecycle / completion

Partial structured tool JSON is never exposed.\n`);

const state: DemoState = { contextRead: false };
let activeTextStep = -1;

const result = await measure.assert(
  {
    label: "Streamed agent demo",
    result: summarizeRun,
  },
  async (trace: MeasureFn) => {
    let modelStep = 0;
    const measuredCall: typeof callLLM = async (tree, options) => {
      const step = ++modelStep;
      const response = await trace(
        {
          label: `Model step ${step}`,
          result: summarizeResponse,
        },
        () => callLLM(tree, options),
      );
      if (response === null) throw new Error(`Model step ${step} failed`);
      return response;
    };

    return runAgent({
      state,
      history: [
        {
          role: "user",
          content:
            "Read the application context and recommend the simplest safe streaming interface for an agent UI.",
        },
      ],
      buildPrompt: (history) => <DemoPrompt history={history} />,
      executeTool: async (call) => {
        const toolResult = await trace(
          {
            label: `Host tool — ${call.name}`,
            ...summarizeToolCall(call),
            result: summarizeToolResult,
          },
          async () => executeTool(call, state),
        );
        if (toolResult === null) throw new Error(`Tool ${call.name} failed`);
        return toolResult;
      },
      call: measuredCall,
      maxSteps: 4,
      maxToolCalls: 4,
      maxDurationMs: 2 * 60_000,
      isComplete: (_response: LLMResponse, _toolResults, context) =>
        Boolean(context.state.completed),
      onNoToolCalls: () => "Use get_context first, then finish.",

      // This is the common chat/UI streaming surface. For Codex these are
      // decoded from the structured response while the turn is still running.
      // For runtimes without structured delta support, jsx-ai falls back to
      // delivering the final assistant text once before model_end.
      onTextDelta: ({ delta, step }) => {
        if (activeTextStep !== step) {
          activeTextStep = step;
          process.stdout.write(`\nassistant[${step + 1}]> `);
        }
        process.stdout.write(delta);
      },

      // Tools remain atomic. The application sees them only after jsx-ai has
      // received and validated the complete structured model response.
      onEvent: (event) => {
        if (
          event.type === "model_end" &&
          activeTextStep === event.context.step
        ) {
          process.stdout.write("\n");
        }
        if (event.type === "tool_start") {
          console.log(`tool> ${event.call.name} started`);
        }
        if (event.type === "tool_end") {
          console.log(
            `tool> ${event.call.name} ${event.result.isError ? "failed" : "finished"}`,
          );
        }
        if (event.type === "stop") {
          console.log(`agent> stopped (${event.reason})`);
        }
      },
    });
  },
);

if (result === null)
  throw new Error("Streaming demo failed; inspect the trace above.");

console.log("\nFinal recommendation");
console.log(result.state.completed ?? "No recommendation produced");
