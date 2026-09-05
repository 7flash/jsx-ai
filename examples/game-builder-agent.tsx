#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Observable iterative game-building agent.
 *
 * Phase 1: creates a playable HTML5 Canvas game.
 * Phase 2: reads the result and improves mechanics/polish.
 * Phase 3: rewrites the renderer with Three.js while preserving gameplay.
 *
 * The jsx-ai core stays silent. This example deliberately owns presentation and
 * uses measure-fn for hierarchical timings plus explicit token/tool/file summaries.
 *
 * Run:
 *   bun run examples/game-builder-agent.tsx ./game-output
 *   JSX_AI_RUNTIME=codex bun run examples/game-builder-agent.tsx ./game-output
 *   JSX_AI_RUNTIME=api JSX_AI_MODEL=<provider-model> bun run examples/game-builder-agent.tsx ./game-output
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentUsage,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";
import {
  measure,
  summarizeAgentRun,
  traceAgent,
  type MeasureFn,
} from "./_example-observability";

const STRATEGY = "hybrid" as const;
const ROOT = resolve(process.argv[2] || "game-output");
const MAX_STEPS = 8;
const MAX_TOOL_CALLS = 48;
const MAX_PHASE_MS = 8 * 60_000;
mkdirSync(ROOT, { recursive: true });

interface PhaseSpec {
  number: number;
  title: string;
  goal: string;
}

interface PhaseReport {
  number: number;
  title: string;
  result: AgentRunResult<undefined>;
}

const PHASES: readonly PhaseSpec[] = [
  {
    number: 1,
    title: "Build Canvas game",
    goal: md`
      PHASE 1 — BUILD THE GAME.
      Create a complete, fun arcade game using plain HTML/CSS/JavaScript and the HTML5 Canvas 2D API.
      Requirements: keyboard controls, score, restart flow, increasing challenge, clear visual feedback,
      and no build step. Keep external dependencies at zero. Create all required files.
    `,
  },
  {
    number: 2,
    title: "Improve gameplay and polish",
    goal: md`
      PHASE 2 — ITERATE ON THE EXISTING CANVAS GAME.
      Inspect the files you built and substantially improve the game rather than merely restyling it.
      Improve game feel, progression, feedback, UI, effects, and code organization while keeping it playable.
      Preserve the strongest mechanics from phase 1 and fix any obvious implementation weaknesses.
    `,
  },
  {
    number: 3,
    title: "Migrate renderer to Three.js",
    goal: md`
      PHASE 3 — REWRITE THE PRESENTATION WITH THREE.JS.
      Inspect the current project, then migrate the visual renderer from Canvas 2D to Three.js using an ES-module CDN import
      so the project still has no package-install/build step. Preserve and improve the gameplay/state logic from the previous
      phases. Use real 3D scene/camera/lighting/geometry where it improves the experience, keep responsive controls/UI,
      and leave the project in a coherent runnable final state. Remove obsolete Canvas-2D rendering code where appropriate.
    `,
  },
];

const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write or replace a UTF-8 file inside the game project"
  >
    <param name="path" type="string" required>
      Project-relative path such as index.html or src/game.js
    </param>
    <param name="content" type="string" required>
      Complete file contents
    </param>
  </tool>
);

const ReadFileTool = () => (
  <tool
    name="read_file"
    description="Read a UTF-8 file from the current game project"
  >
    <param name="path" type="string" required>
      Project-relative path
    </param>
  </tool>
);

const ListFilesTool = () => (
  <tool
    name="list_files"
    description="List all files currently present in the game project"
  />
);

const PhaseDoneTool = () => (
  <tool
    name="phase_done"
    description="Finish the current phase only when its goal is implemented coherently"
  >
    <param name="summary" type="string" required>
      What changed and what the next phase should know
    </param>
  </tool>
);

function safePath(relativePath: string): string {
  const full = resolve(ROOT, relativePath);
  const rel = relative(ROOT, full);
  if (rel.startsWith("..") || rel === "..")
    throw new Error(`Path escapes project root: ${relativePath}`);
  return full;
}

function listFiles(dir = ROOT): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) result.push(...listFiles(full));
    else result.push(relative(ROOT, full));
  }
  return result.sort();
}

function fileManifest(): Array<{ file: string; bytes: number }> {
  return listFiles().map((file) => ({
    file,
    bytes: statSync(safePath(file)).size,
  }));
}

function executeTool(call: CanonicalToolCall): ExtractedMessage {
  try {
    switch (call.name) {
      case "write_file": {
        const path = safePath(String(call.args.path || ""));
        const content = String(call.args.content || "");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf-8");
        return toolResult(
          call,
          `Wrote ${relative(ROOT, path)} (${content.length} chars).`,
        );
      }
      case "read_file": {
        const path = safePath(String(call.args.path || ""));
        return toolResult(call, readFileSync(path, "utf-8"));
      }
      case "list_files":
        return toolResult(call, JSON.stringify(fileManifest(), null, 2));
      case "phase_done":
        return toolResult(
          call,
          `Phase accepted: ${String(call.args.summary || "")}`,
        );
      default:
        return toolResult(call, `Unknown tool: ${call.name}`, true);
    }
  } catch (error) {
    return toolResult(
      call,
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

function toolResult(
  call: CanonicalToolCall,
  content: string,
  isError = false,
): ExtractedMessage {
  return {
    role: "tool",
    content,
    toolCallId: call.id,
    toolName: call.name,
    ...(isError ? { isError: true } : {}),
  };
}

function promptTree(history: readonly ExtractedMessage[]) {
  return (
    <prompt strategy={STRATEGY} maxTokens={14000}>
      <system>{md`
        You are an autonomous browser-game engineer working in a real project directory.
        Use the file tools to inspect and modify the project. Prefer a small coherent codebase.
        The game must run by opening index.html from a simple static web server.
        Do not claim a phase is complete until the requested game is playable and the files agree.
        When modifying existing work, read relevant files first if the full current source is not already in context.
      `}</system>
      <WriteFileTool />
      <ReadFileTool />
      <ListFilesTool />
      <PhaseDoneTool />
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
    </prompt>
  );
}

function summarizeAgentResult(
  result: AgentRunResult<undefined>,
): Record<string, unknown> {
  const codexSteps = result.steps.filter((step) =>
    step.response.request?.url?.startsWith("codex://"),
  );
  const bridgePromptChars = codexSteps.reduce((total, step) => {
    const value = step.response.request?.body.bridgePromptChars;
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  return summarizeAgentRun(result, () => ({
    ...(codexSteps.length
      ? {
          codexBridge: {
            turns: codexSteps.length,
            promptChars: bridgePromptChars,
          },
        }
      : {}),
    files: fileManifest(),
  }));
}

function addUsage(target: AgentUsage, usage: AgentUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.thinkingTokens += usage.thinkingTokens;
}

async function runPhase(
  trace: MeasureFn,
  phase: PhaseSpec,
): Promise<AgentRunResult<undefined>> {
  return traceAgent(
    trace,
    {
      label: `Phase ${phase.number} — ${phase.title}`,
      metadata: {
        phase: phase.number,
        maxSteps: MAX_STEPS,
        maxToolCalls: MAX_TOOL_CALLS,
      },
      llm: { metadata: () => ({ strategy: STRATEGY }) },
      summarizeResult: summarizeAgentResult,
    },
    async ({ call, measureTool, reportRuntimeProgress }) => {
      const result = await runAgent({
        // Each phase is intentionally a fresh model session. The generated
        // workspace is durable state; a phase may run in a new process days
        // later and inspect the files it needs through the host tools.
        history: [{ role: "user", content: phase.goal }],
        buildPrompt: (phaseHistory) => promptTree(phaseHistory),
        executeTool: measureTool(executeTool),
        call,
        maxSteps: MAX_STEPS,
        maxToolCalls: MAX_TOOL_CALLS,
        maxDurationMs: MAX_PHASE_MS,
        isComplete: (response) =>
          response.toolCalls.some((toolCall) => toolCall.name === "phase_done"),
        onNoToolCalls: (response) =>
          response.text.trim()
            ? "Continue by using the available tools. Call phase_done only after the phase is implemented."
            : "Use the available tools to continue the phase. Call phase_done only when implementation is complete.",
        onEvent: (event) => {
          if (event.type === "runtime_progress") {
            reportRuntimeProgress(event.progress, event.context.step + 1);
          }
        },
      });

      if (result.reason !== "completed") {
        throw new Error(
          `Phase stopped with ${result.reason} after ${result.steps.length} model step(s).`,
        );
      }
      return result;
    },
  );
}

function printFinalSummary(
  reports: readonly PhaseReport[],
  totalUsage: AgentUsage,
  elapsedMs: number,
): void {
  const totalTokens =
    totalUsage.inputTokens +
    totalUsage.outputTokens +
    totalUsage.thinkingTokens;
  console.log("\nRun summary");
  console.table(
    reports.map((report) => ({
      phase: report.number,
      name: report.title,
      steps: report.result.steps.length,
      tools: report.result.toolCallsExecuted,
      inputTokens: report.result.usage.inputTokens,
      outputTokens: report.result.usage.outputTokens,
      thinkingTokens: report.result.usage.thinkingTokens,
      elapsedMs: report.result.elapsedMs,
    })),
  );
  console.log(
    `Total tokens: ${totalUsage.inputTokens} input + ${totalUsage.outputTokens} output` +
      (totalUsage.thinkingTokens
        ? ` + ${totalUsage.thinkingTokens} thinking`
        : "") +
      ` = ${totalTokens}`,
  );
  console.log(`Total elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Output directory: ${ROOT}`);
  console.log("\nGenerated files");
  console.table(fileManifest());
}

console.log(
  [
    "jsx-ai game builder",
    "runtime/model: resolved by jsx-ai (JSX_AI_RUNTIME / JSX_AI_MODEL)",
    `strategy: ${STRATEGY} (API runtime; Codex uses its structured bridge)`,
    `output: ${ROOT}`,
    `budgets: ${MAX_STEPS} model steps / ${MAX_TOOL_CALLS} tool calls / ${MAX_PHASE_MS / 60_000} min per phase`,
  ].join("\n"),
);
console.log();

const runStartedAt = Date.now();
const reports: PhaseReport[] = [];
const totalUsage: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
};
await measure.assert(
  {
    label: "Game-builder run",
    strategy: STRATEGY,
    phases: PHASES.length,
    output: ROOT,
    result: () => ({
      phases: reports.length,
      files: fileManifest().length,
      tokens: totalUsage,
    }),
  },
  async (trace: MeasureFn) => {
    for (const phase of PHASES) {
      const result = await runPhase(trace, phase);
      reports.push({ number: phase.number, title: phase.title, result });
      addUsage(totalUsage, result.usage);
    }
    return reports;
  },
);

printFinalSummary(reports, totalUsage, Date.now() - runStartedAt);
