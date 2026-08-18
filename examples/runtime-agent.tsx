#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Runtime-neutral jsx-ai host-tool agent.
 *
 * Select execution outside the example:
 *   JSX_AI_RUNTIME=api bun run example:runtime ./runtime-output "Create index.html"
 *   JSX_AI_RUNTIME=codex bun run example:runtime ./runtime-output "Create index.html"
 *
 * When Codex is selected, jsx-ai uses the local Codex SDK/CLI and its saved login.
 * The example itself contains no provider/runtime branch.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";
import {
  createRuntimeProgressReporter,
  measure,
  summarizeResponse,
  summarizeToolCall,
  truncate,
  type MeasureFn,
} from "./_example-observability";

const ROOT = resolve(process.argv[2] || "runtime-output");
const TASK =
  process.argv[3] ||
  "Create a small polished index.html page that explains jsx-ai in plain language.";
const MAX_STEPS = 8;
const MAX_TOOL_CALLS = 32;
const MAX_DURATION_MS = 8 * 60_000;

mkdirSync(ROOT, { recursive: true });

interface AgentState {
  completedSummary?: string;
}

const WorkspaceTools = () => (
  <>
    <tool
      name="list_files"
      description="List files in the application-owned workspace"
    />

    <tool
      name="read_file"
      description="Read one UTF-8 file from the application-owned workspace"
    >
      <param name="path" type="string" required>
        Project-relative file path
      </param>
    </tool>

    <tool
      name="write_file"
      description="Write or replace one UTF-8 file in the application-owned workspace"
    >
      <param name="path" type="string" required>
        Project-relative file path
      </param>
      <param name="content" type="string" required>
        Complete file contents
      </param>
    </tool>

    <tool
      name="done"
      description="Finish only after the requested work is complete and coherent"
    >
      <param name="summary" type="string" required>
        Concise description of the completed work
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

function AgentPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt strategy="hybrid">
      <system>{md`
        You are an autonomous coding agent operating through application-owned tools.

        Treat list_files, read_file, write_file, and done as the only way to change or
        report application workspace state. Inspect before overwriting existing work.
        Keep changes small and coherent. Call done only after the user's task is actually complete.
      `}</system>
      <WorkspaceTools />
      <Conversation history={history} />
    </prompt>
  );
}

function safePath(path: string): string {
  const full = resolve(ROOT, path);
  const rel = relative(ROOT, full);
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Path escapes workspace: ${path}`);
  }
  return full;
}

function listFiles(dir = ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(relative(ROOT, full));
  }
  return files.sort();
}

function fileManifest(): Array<{ file: string; bytes: number }> {
  return listFiles().map((file) => ({
    file,
    bytes: statSync(safePath(file)).size,
  }));
}

function executeTool(
  call: CanonicalToolCall,
  state: AgentState,
): AgentToolResult {
  try {
    switch (call.name) {
      case "list_files":
        return { content: JSON.stringify(fileManifest(), null, 2) };

      case "read_file": {
        const path = String(call.args.path ?? "");
        return { content: readFileSync(safePath(path), "utf8") };
      }

      case "write_file": {
        const path = String(call.args.path ?? "");
        const content = String(call.args.content ?? "");
        if (!path)
          return { content: "write_file requires path", isError: true };
        const full = safePath(path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, "utf8");
        return {
          content: `Wrote ${relative(ROOT, full)} (${content.length} chars).`,
        };
      }

      case "done": {
        const summary = String(call.args.summary ?? "").trim();
        if (!summary)
          return {
            content: "done requires a non-empty summary",
            isError: true,
          };
        if (fileManifest().length === 0) {
          return {
            content: "done rejected: the workspace is still empty",
            isError: true,
          };
        }
        state.completedSummary = summary;
        return { content: `Completion accepted: ${summary}` };
      }

      default:
        return { content: `Unknown tool: ${call.name}`, isError: true };
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

function summarizeToolResult(result: AgentToolResult): Record<string, unknown> {
  return {
    error: result.isError ?? false,
    resultChars: result.content.length,
    preview: truncate(result.content.replace(/\s+/g, " "), 160),
  };
}

function summarizeAgentResult(
  result: AgentRunResult<AgentState>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    tokens: result.usage,
    elapsedMs: result.elapsedMs,
    files: fileManifest(),
    summary: result.state.completedSummary ?? "",
  };
}

console.log(
  [
    "jsx-ai runtime-neutral agent",
    "runtime/model: resolved by jsx-ai (JSX_AI_RUNTIME / JSX_AI_MODEL)",
    `workspace: ${ROOT}`,
    `task: ${TASK}`,
  ].join("\n"),
);
console.log();

const state: AgentState = {};

const measured = await measure.assert(
  {
    label: "jsx-ai host-tool agent",
    workspace: ROOT,
    result: summarizeAgentResult,
  },
  async (trace: MeasureFn) => {
    let modelStep = 0;
    const reportRuntimeProgress = createRuntimeProgressReporter();
    const measuredCall: typeof callLLM = async (tree, options) => {
      const step = ++modelStep;
      const response = await trace(
        {
          label: `Model step ${step}`,
          result: summarizeResponse,
        },
        () => callLLM(tree, options),
      );
      if (response === null)
        throw new Error(`Model step ${step} failed; inspect the trace above.`);
      return response;
    };

    return runAgent({
      state,
      history: [{ role: "user", content: TASK }],
      buildPrompt: (history) => <AgentPrompt history={history} />,
      executeTool: async (call) => {
        const result = await trace(
          {
            label: `Host tool — ${call.name}`,
            ...summarizeToolCall(call),
            result: summarizeToolResult,
          },
          async () => executeTool(call, state),
        );
        if (result === null)
          throw new Error(`Tool ${call.name} failed inside the example trace.`);
        return result;
      },
      call: measuredCall,
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      maxDurationMs: MAX_DURATION_MS,
      isComplete: (_response, _toolResults, context) =>
        Boolean(context.state.completedSummary),
      onNoToolCalls: (response) =>
        response.text.trim()
          ? "Continue with the declared application tools. Call done only when the task is complete."
          : "Use the declared application tools to continue the task.",
      onEvent: (event) => {
        if (event.type === "runtime_progress") {
          reportRuntimeProgress(event.progress, event.context.step + 1);
        }
      },
    });
  },
);

if (measured === null)
  throw new Error("Agent failed; inspect the trace above.");
if (measured.reason !== "completed") {
  throw new Error(
    `Agent stopped with ${measured.reason} after ${measured.steps.length} model step(s).`,
  );
}

const totalTokens =
  measured.usage.inputTokens +
  measured.usage.outputTokens +
  measured.usage.thinkingTokens;
console.log("\nFinal summary");
console.log(`Completed: ${measured.state.completedSummary ?? "yes"}`);
console.log(`Model steps: ${measured.steps.length}`);
console.log(`Host tool calls: ${measured.toolCallsExecuted}`);
console.log(
  `Tokens reported by the selected runtime: ${measured.usage.inputTokens} input + ${measured.usage.outputTokens} output` +
    (measured.usage.thinkingTokens
      ? ` + ${measured.usage.thinkingTokens} reasoning`
      : "") +
    ` = ${totalTokens}`,
);
console.log(`Elapsed: ${(measured.elapsedMs / 1000).toFixed(1)}s`);
console.log(`Workspace: ${ROOT}`);
console.table(fileManifest());
