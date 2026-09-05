#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * The common streamed-agent UI pattern uses one ordered `onEvent` stream:
 *
 *   text_delta      → what the agent is saying
 *   tool_progress   → what action the model is preparing
 *   tool_start/end  → what the host is actually executing
 *
 * `onTextDelta` and `onToolProgress` remain convenience callbacks when an app
 * prefers separate handlers. No raw partial JSON is exposed and progressive
 * tool parsing can never execute a tool.
 */

import { md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
  LLMResponse,
} from "../src/index";
import { measureAgent, summarizeAgentRun } from "./_example-observability";

interface DemoState {
  saved?: { path: string; content: string };
}

const DemoTools = () => (
  <>
    <tool
      name="save_recommendation"
      description="Save the final recommendation in the application"
    >
      <param name="path" type="string" required>
        Output path
      </param>
      <param name="content" type="string" required>
        Recommendation Markdown
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
          attachments={message.attachments}
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
        You are demonstrating a streamed application agent.

        Briefly tell the user what recommendation you are preparing, then call
        save_recommendation with path "recommendation.md" and a useful Markdown
        recommendation in content. Keep visible assistant text concise.
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
  if (call.name !== "save_recommendation") {
    return { content: `Unknown tool: ${call.name}`, isError: true };
  }

  const path = String(call.args.path ?? "").trim();
  const content = String(call.args.content ?? "");
  if (!path || !content.trim()) {
    return {
      content: "save_recommendation requires path and content",
      isError: true,
    };
  }

  // This demo keeps the side effect in memory. A real app could write a file,
  // update a database, enqueue a job, etc. Only this function performs it.
  state.saved = { path, content };
  return { content: `Saved ${content.length} characters to ${path}` };
}

function summarizeRun(
  result: AgentRunResult<DemoState>,
): Record<string, unknown> {
  return summarizeAgentRun(result, (state) => ({
    savedPath: state.saved?.path ?? "",
    savedChars: state.saved?.content.length ?? 0,
  }));
}

console.log(`jsx-ai practical streamed agent

Application UI contract — one ordered onEvent stream:
  text_delta      what the agent is saying
  tool_progress   what tool/fields the model is preparing
  tool_start/end  what the host is actually executing
`);

const state: DemoState = {};
let activeTextStep = -1;
let generatedContentChars = 0;
let preparedPath = "";

const result = await measureAgent(
  {
    label: "Streamed agent demo",
    summarizeResult: summarizeRun,
  },
  async ({ call, measureTool }) =>
    runAgent({
      state,
      history: [
        {
          role: "user",
          content:
            "Recommend the simplest safe streaming interface for an agent UI.",
        },
      ],
      buildPrompt: (history) => <DemoPrompt history={history} />,
      executeTool: measureTool((toolCall) => executeTool(toolCall, state)),
      call,
      maxSteps: 2,
      maxToolCalls: 2,
      maxDurationMs: 2 * 60_000,
      isComplete: (_response: LLMResponse, _toolResults, context) =>
        Boolean(context.state.saved),

      onEvent: (event) => {
        if (event.type === "text_delta") {
          const step = event.context.step;
          if (activeTextStep !== step) {
            activeTextStep = step;
            process.stdout.write(`\nassistant> `);
          }
          process.stdout.write(event.delta);
          return;
        }

        if (event.type === "tool_progress") {
          const progress = event.progress;
          if (progress.type === "tool_detected") {
            console.log(`\nprepare> ${progress.name}`);
          }

          if (progress.type === "field_ready" && progress.path[0] === "path") {
            preparedPath = String(progress.value);
            console.log(`prepare> path = ${preparedPath}`);
          }

          if (
            progress.type === "field_delta" &&
            progress.path[0] === "content"
          ) {
            generatedContentChars += progress.delta.length;
            process.stdout.write(
              `\rprepare> ${preparedPath || "content"} · ${generatedContentChars} chars generated`,
            );
          }

          if (progress.type === "tool_ready") {
            process.stdout.write("\n");
            console.log(
              `prepare> ${progress.call.name} ready — waiting for host execution`,
            );
          }
          return;
        }

        if (
          event.type === "model_end" &&
          activeTextStep === event.context.step
        ) {
          process.stdout.write("\n");
        }
        if (event.type === "tool_start") {
          console.log(`execute> ${event.call.name} started`);
        }
        if (event.type === "tool_end") {
          console.log(
            `execute> ${event.call.name} ${event.result.isError ? "failed" : "finished"}`,
          );
        }
        if (event.type === "stop") {
          console.log(`agent> stopped (${event.reason})`);
        }
      },
    }),
);

console.log("\nSaved recommendation");
console.log(result.state.saved?.content ?? "No recommendation produced");
