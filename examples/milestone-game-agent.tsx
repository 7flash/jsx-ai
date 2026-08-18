#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Milestone-driven browser-game agent.
 *
 * This example demonstrates the intended jsx-ai split of responsibilities:
 *
 *   JSX components  -> describe prompts, tools, and agent capabilities
 *   runAgent()      -> owns model/tool/history iteration and budgets
 *   application    -> owns filesystem side effects and artifact validation
 *   measure-fn     -> owns example-only observability
 *
 * Unlike a hand-written agent loop, this file never manually appends assistant
 * tool calls or tool-result messages. Each milestone runs with a fresh model
 * history and treats the workspace as durable external state.
 *
 * Run:
 *   bun run examples/milestone-game-agent.tsx ./milestone-game "tiny neon survival game"
 *   GAME_MODEL=gemini-3-flash-preview bun run examples/milestone-game-agent.tsx
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentContext,
  AgentRunResult,
  AgentUsage,
  CanonicalToolCall,
  ExtractedMessage,
  JsonObject,
  JsonValue,
  ToolParametersSchema,
} from "../src/index";
import {
  measure,
  summarizeResponse,
  summarizeToolCall,
  truncate,
  type MeasureFn,
} from "./_example-observability";

const MODEL = process.env.GAME_MODEL || "gemini-3-flash-preview";
const STRATEGY = "hybrid" as const;
const TEMPERATURE = /^gemini-3(?:\.|-|$)/i.test(MODEL) ? 1.0 : 0.2;
const ROOT = resolve(process.argv[2] || "milestone-game-output");
const IDEA =
  process.argv.slice(3).join(" ").trim() ||
  "A tiny neon arcade survival game where the player dodges hazards and builds a score multiplier.";

const MAX_PLAN_STEPS = 3;
const MAX_MILESTONE_STEPS = 8;
const MAX_TOOL_CALLS = 48;
const MAX_MILESTONE_MS = 8 * 60_000;

mkdirSync(ROOT, { recursive: true });

interface MilestonePlan {
  title: string;
  goal: string;
  cost: number;
}

interface GamePlan {
  slug: string;
  summary: string;
  milestones: MilestonePlan[];
}

interface PlanningState {
  plan?: GamePlan;
}

interface CompletionState {
  completion?: {
    summary: string;
  };
}

interface MilestoneReport {
  number: number;
  title: string;
  result: AgentRunResult<CompletionState>;
}

const PLAN_SCHEMA: ToolParametersSchema = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description: "Short kebab-case game name",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    summary: {
      type: "string",
      description: "One plain sentence describing the game",
      minLength: 8,
      maxLength: 180,
    },
    milestones: {
      type: "array",
      description: "Exactly three concrete implementation milestones",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Concrete 3-7 word milestone title",
          },
          goal: {
            type: "string",
            description:
              "What the player should be able to experience after this milestone",
          },
          cost: {
            type: "integer",
            minimum: 1,
            maximum: 4,
          },
        },
        required: ["title", "goal", "cost"],
        additionalProperties: false,
      },
    },
  },
  required: ["slug", "summary", "milestones"],
  additionalProperties: false,
};

const COMPLETE_SCHEMA: ToolParametersSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Concise description of the completed gameplay work",
      minLength: 8,
      maxLength: 240,
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

const PlanningTools = () => (
  <tool
    name="submit_game_plan"
    description="Submit the complete three-milestone game plan"
    schema={PLAN_SCHEMA}
  />
);

const WorkspaceTools = () => (
  <>
    <tool
      name="write_file"
      description="Write or replace a UTF-8 file inside the game project"
    >
      <param name="path" type="string" required>
        Project-relative path such as index.html
      </param>
      <param name="content" type="string" required>
        Complete file contents
      </param>
    </tool>

    <tool
      name="read_file"
      description="Read a UTF-8 file from the current game project"
    >
      <param name="path" type="string" required>
        Project-relative path
      </param>
    </tool>

    <tool
      name="list_files"
      description="List the current game project files and byte sizes"
    />

    <tool
      name="complete_milestone"
      description="Request milestone completion; the host validates index.html before accepting it"
      schema={COMPLETE_SCHEMA}
    />
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

function PlanningPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt
      model={MODEL}
      strategy={STRATEGY}
      temperature={TEMPERATURE}
      maxTokens={1800}
    >
      <system>{md`
        You are a game designer planning a tiny browser game that will be implemented by an autonomous coding agent.

        Produce exactly three milestones:

        - Milestone 1 must create an immediately playable self-contained game, not a scaffold.
        - Milestone 2 must materially improve gameplay, progression, feedback, or game feel.
        - Milestone 3 must deepen the game rather than merely restyle it.
        - Costs are whole numbers from 1 to 4.

        Do not answer with a custom text format. Submit the plan through submit_game_plan.
      `}</system>
      <PlanningTools />
      <Conversation history={history} />
    </prompt>
  );
}

function MilestonePrompt({
  history,
}: {
  history: readonly ExtractedMessage[];
}) {
  return (
    <prompt
      model={MODEL}
      strategy={STRATEGY}
      temperature={TEMPERATURE}
      maxTokens={14_000}
    >
      <system>{md`
        You are an autonomous browser-game engineer working in a real project directory.

        Use the workspace tools to inspect and modify the project. The workspace, not old chat history,
        is the durable source of truth between milestones.

        Artifact contract:

        - index.html must be a complete self-contained HTML document.
        - Plain HTML/CSS/JavaScript; no build step.
        - No external scripts, fonts, images, imports, CDNs, fetches, websockets, or network requests.
        - No localStorage, sessionStorage, or IndexedDB.
        - Fill the frame and keep the game responsive.
        - Support keyboard and pointer input and show controls on screen.
        - Include a real game loop, score or win/lose state, and restart without a reload.
        - Prefer a compact coherent implementation over many files.
        - Read relevant existing files before modifying them unless their full current source is already in context.

        complete_milestone is not ceremonial. The host validates index.html and may reject completion with concrete errors.
        Keep working until that validation succeeds.
      `}</system>
      <WorkspaceTools />
      <Conversation history={history} />
    </prompt>
  );
}

function asObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function asArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function asString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function asInteger(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`${label} must be an integer`);
  return value;
}

function parsePlan(args: JsonObject): GamePlan {
  const milestones = asArray(args.milestones, "milestones").map(
    (value, index) => {
      const item = asObject(value, `milestones[${index}]`);
      const title = asString(item.title, `milestones[${index}].title`);
      const words = title.split(/\s+/).filter(Boolean).length;
      if (words < 3 || words > 7)
        throw new Error(`milestones[${index}].title must contain 3-7 words`);

      const cost = asInteger(item.cost, `milestones[${index}].cost`);
      if (cost < 1 || cost > 4)
        throw new Error(`milestones[${index}].cost must be between 1 and 4`);

      return {
        title,
        goal: asString(item.goal, `milestones[${index}].goal`),
        cost,
      };
    },
  );

  if (milestones.length !== 3)
    throw new Error("A game plan must contain exactly three milestones");

  return {
    slug: asString(args.slug, "slug"),
    summary: asString(args.summary, "summary"),
    milestones,
  };
}

function safePath(relativePath: string): string {
  if (!relativePath.trim()) throw new Error("path is required");
  const full = resolve(ROOT, relativePath);
  const rel = relative(ROOT, full);
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
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

function manifest(): Array<{ file: string; bytes: number }> {
  return listFiles().map((file) => ({
    file,
    bytes: statSync(safePath(file)).size,
  }));
}

function validateArtifact(html: string): string[] {
  const issues: string[] = [];
  const lower = html.toLowerCase();

  if (!/<!doctype\s+html/i.test(html))
    issues.push("index.html must include <!doctype html>");
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html))
    issues.push("index.html must be a complete HTML document");
  if (!/<script[\s>]/i.test(html))
    issues.push("index.html must contain game JavaScript");
  if (!/(<canvas[\s>]|requestanimationframe\s*\()/i.test(html))
    issues.push("index.html must contain an actual rendering/game loop");
  if (!/(score|points|win|lose|game over)/i.test(html))
    issues.push("index.html should expose score or a win/lose state");
  if (!/(restart|reset)/i.test(html))
    issues.push("index.html must provide restart/reset behavior");

  const forbidden: Array<[RegExp, string]> = [
    [/<script[^>]+src\s*=/i, "external script src is not allowed"],
    [
      /<link[^>]+href\s*=/i,
      "external stylesheet/resource links are not allowed",
    ],
    [/\bfetch\s*\(/i, "fetch/network requests are not allowed"],
    [/\bwebsocket\b/i, "websockets are not allowed"],
    [/\blocalstorage\b/i, "localStorage is not allowed"],
    [/\bsessionstorage\b/i, "sessionStorage is not allowed"],
    [/\bindexeddb\b/i, "IndexedDB is not allowed"],
    [/\bhttps?:\/\//i, "external URLs are not allowed"],
  ];

  for (const [pattern, message] of forbidden) {
    if (pattern.test(lower)) issues.push(message);
  }

  return issues;
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

function executePlanningTool(
  call: CanonicalToolCall,
  context: AgentContext<PlanningState>,
): ExtractedMessage {
  if (call.name !== "submit_game_plan") {
    return toolResult(call, `Unknown planning tool: ${call.name}`, true);
  }

  try {
    const plan = parsePlan(call.args);
    context.state.plan = plan;
    return toolResult(
      call,
      `Accepted plan ${plan.slug} with ${plan.milestones.length} milestones.`,
    );
  } catch (error) {
    return toolResult(
      call,
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

function executeWorkspaceTool(
  call: CanonicalToolCall,
  context: AgentContext<CompletionState>,
): ExtractedMessage {
  try {
    switch (call.name) {
      case "write_file": {
        const requestedPath = asString(call.args.path, "path");
        const content = asString(call.args.content, "content");
        const full = safePath(requestedPath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, "utf-8");
        return toolResult(
          call,
          `Wrote ${relative(ROOT, full)} (${content.length} chars).`,
        );
      }

      case "read_file": {
        const requestedPath = asString(call.args.path, "path");
        return toolResult(call, readFileSync(safePath(requestedPath), "utf-8"));
      }

      case "list_files":
        return toolResult(call, JSON.stringify(manifest(), null, 2));

      case "complete_milestone": {
        const summary = asString(call.args.summary, "summary");
        const indexPath = safePath("index.html");
        const html = readFileSync(indexPath, "utf-8");
        const issues = validateArtifact(html);
        if (issues.length) {
          return toolResult(
            call,
            `Completion rejected. Fix index.html and try again:\n- ${issues.join("\n- ")}`,
            true,
          );
        }

        context.state.completion = { summary };
        return toolResult(call, `Milestone accepted: ${summary}`);
      }

      default:
        return toolResult(call, `Unknown workspace tool: ${call.name}`, true);
    }
  } catch (error) {
    return toolResult(
      call,
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

function summarizeToolResult(
  message: ExtractedMessage,
): Record<string, unknown> {
  if (message.role !== "tool") return { role: message.role };
  return {
    tool: message.toolName,
    error: message.isError ?? false,
    resultChars: message.content.length,
    preview: truncate(message.content.replace(/\s+/g, " "), 180),
  };
}

function summarizeRun<State>(
  result: AgentRunResult<State>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    elapsedMs: result.elapsedMs,
    tokens: result.usage,
  };
}

function addUsage(target: AgentUsage, usage: AgentUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.thinkingTokens += usage.thinkingTokens;
}

function measuredCall(trace: MeasureFn, prefix: string): typeof callLLM {
  let step = 0;
  return async (tree, options) => {
    const current = ++step;
    const response = await trace(
      {
        label: `${prefix} model step ${current}`,
        step: current,
        model: options?.model ?? MODEL,
        strategy: options?.strategy ?? STRATEGY,
        result: summarizeResponse,
      },
      () => callLLM(tree, options),
    );

    if (response === null)
      throw new Error(
        `${prefix} model step ${current} failed; see trace above.`,
      );
    return response;
  };
}

async function planGame(
  trace: MeasureFn,
): Promise<{ plan: GamePlan; result: AgentRunResult<PlanningState> }> {
  const state: PlanningState = {};
  const result = await trace(
    {
      label: "Plan game",
      result: summarizeRun,
    },
    async (planTrace: MeasureFn) =>
      runAgent({
        state,
        history: [{ role: "user", content: IDEA }],
        buildPrompt: (history) => <PlanningPrompt history={history} />,
        executeTool: async (call, context) => {
          const output = await planTrace(
            {
              label: `Planning tool — ${call.name}`,
              ...summarizeToolCall(call),
              result: summarizeToolResult,
            },
            async () => executePlanningTool(call, context),
          );
          if (output === null)
            throw new Error(`Planning tool ${call.name} failed inside trace.`);
          return output;
        },
        call: measuredCall(planTrace, "Plan"),
        callOptions: {
          model: MODEL,
          strategy: STRATEGY,
          retries: 3,
          timeoutMs: 90_000,
        },
        maxSteps: MAX_PLAN_STEPS,
        maxToolCalls: 2,
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.plan),
        onNoToolCalls: () => "Submit the complete plan using submit_game_plan.",
      }),
  );

  if (result === null) throw new Error("Planning failed; see trace above.");
  if (result.reason !== "completed" || !state.plan) {
    throw new Error(
      `Planning stopped with ${result.reason} without a valid plan.`,
    );
  }
  return { plan: state.plan, result };
}

async function buildMilestone(
  trace: MeasureFn,
  plan: GamePlan,
  milestone: MilestonePlan,
  index: number,
): Promise<AgentRunResult<CompletionState>> {
  const state: CompletionState = {};
  const existingFiles = manifest();
  const goal = md`
        GAME: ${plan.summary}
        MILESTONE ${index + 1} OF ${plan.milestones.length}: ${milestone.title}
        GOAL: ${milestone.goal}
        BUDGET SIGNAL: ${milestone.cost}/4

        ${
          existingFiles.length
            ? `The workspace already contains: ${existingFiles.map((file) => file.file).join(", ")}. Inspect relevant files and evolve the existing game.`
            : "The workspace is empty. Build the first immediately playable version now."
        }

        Preserve strong existing mechanics. Do not satisfy this milestone with cosmetic changes alone.
        Leave a complete self-contained index.html, then call complete_milestone.
    `;

  const measured = await trace(
    {
      label: `Milestone ${index + 1} — ${milestone.title}`,
      milestone: index + 1,
      cost: milestone.cost,
      result: summarizeRun,
    },
    async (milestoneTrace: MeasureFn) =>
      runAgent({
        state,
        // Fresh model history per milestone. The filesystem is durable state.
        history: [{ role: "user", content: goal }],
        buildPrompt: (history) => <MilestonePrompt history={history} />,
        executeTool: async (call, context) => {
          const output = await milestoneTrace(
            {
              label: `Tool — ${call.name}`,
              ...summarizeToolCall(call),
              result: summarizeToolResult,
            },
            async () => executeWorkspaceTool(call, context),
          );
          if (output === null)
            throw new Error(`Tool ${call.name} failed inside trace.`);
          return output;
        },
        call: measuredCall(milestoneTrace, `Milestone ${index + 1}`),
        callOptions: {
          model: MODEL,
          strategy: STRATEGY,
          retries: 3,
          timeoutMs: 90_000,
        },
        maxSteps: MAX_MILESTONE_STEPS,
        maxToolCalls: MAX_TOOL_CALLS,
        maxDurationMs: MAX_MILESTONE_MS,
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.completion),
        onNoToolCalls: (response) =>
          response.text.trim()
            ? "Continue with the workspace tools. complete_milestone is valid only after the artifact passes host validation."
            : "Inspect or modify the workspace with tools and continue the milestone.",
      }),
  );

  if (measured === null)
    throw new Error(`Milestone ${index + 1} failed; see trace above.`);
  if (measured.reason !== "completed" || !state.completion) {
    throw new Error(
      `Milestone ${index + 1} stopped with ${measured.reason} before validated completion.`,
    );
  }
  return measured;
}

function printPlan(plan: GamePlan): void {
  console.log(`\nPlan: ${plan.slug}`);
  console.log(plan.summary);
  console.table(
    plan.milestones.map((milestone, index) => ({
      milestone: index + 1,
      title: milestone.title,
      cost: milestone.cost,
      goal: milestone.goal,
    })),
  );
}

function printSummary(
  reports: readonly MilestoneReport[],
  planning: AgentRunResult<PlanningState>,
  totalUsage: AgentUsage,
  elapsedMs: number,
): void {
  console.log("\nRun summary");
  console.table([
    {
      phase: "plan",
      steps: planning.steps.length,
      tools: planning.toolCallsExecuted,
      inputTokens: planning.usage.inputTokens,
      outputTokens: planning.usage.outputTokens,
      thinkingTokens: planning.usage.thinkingTokens,
      elapsedMs: planning.elapsedMs,
    },
    ...reports.map((report) => ({
      phase: `milestone ${report.number}`,
      steps: report.result.steps.length,
      tools: report.result.toolCallsExecuted,
      inputTokens: report.result.usage.inputTokens,
      outputTokens: report.result.usage.outputTokens,
      thinkingTokens: report.result.usage.thinkingTokens,
      elapsedMs: report.result.elapsedMs,
    })),
  ]);

  const totalTokens =
    totalUsage.inputTokens +
    totalUsage.outputTokens +
    totalUsage.thinkingTokens;
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
  console.table(manifest());
}

console.log(
  [
    "jsx-ai milestone game agent",
    `idea: ${IDEA}`,
    `model: ${MODEL}`,
    `strategy: ${STRATEGY}`,
    `temperature: ${TEMPERATURE}`,
    `workspace: ${ROOT}`,
  ].join("\n"),
);
console.log();

const startedAt = Date.now();
const totalUsage: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
};
const reports: MilestoneReport[] = [];

const run = await measure(
  {
    label: "Milestone game run",
    model: MODEL,
    strategy: STRATEGY,
  },
  async (trace: MeasureFn) => {
    const { plan, result: planningResult } = await planGame(trace);
    addUsage(totalUsage, planningResult.usage);
    printPlan(plan);

    for (let index = 0; index < plan.milestones.length; index++) {
      const milestone = plan.milestones[index]!;
      const result = await buildMilestone(trace, plan, milestone, index);
      addUsage(totalUsage, result.usage);
      reports.push({ number: index + 1, title: milestone.title, result });
    }

    return { plan, planningResult };
  },
);

if (run === null)
  throw new Error("Milestone game run failed; see measure-fn trace above.");
printSummary(reports, run.planningResult, totalUsage, Date.now() - startedAt);
