#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Codex + Stagehand V3 local visual game-QA agent.
 *
 * The model reasons with jsx-ai/Codex. Stagehand V3 provides deterministic local
 * Chromium primitives directly from Bun; no Playwright or Node sidecar is involved.
 *
 * The host exposes only semantic game tools. Screenshots come back as canonical
 * image attachments, so the next model step actually sees the running game.
 *
 * Run:
 *   bun run example:stagehand
 *   STAGEHAND_GAME_URL=http://localhost:3001 bun run example:stagehand
 *
 * Optional task:
 *   bun run example:stagehand "Test movement and identify the three highest-impact visual issues"
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
  LLMResponse,
} from "../src/index";
import {
  StagehandGameBrowser,
  type StagehandGameSession,
  type StagehandSnapshot,
} from "./_stagehand-game-browser";
import { measureAgent, summarizeAgentRun } from "./_example-observability";

const GAME_URL =
  process.env.STAGEHAND_GAME_URL?.trim() || "http://localhost:3001";
const ROOT = resolve(
  process.env.STAGEHAND_ARTIFACT_DIR?.trim() || "stagehand-game-output",
);
const TASK =
  process.argv[2]?.trim() ||
  [
    "Play-test this browser game as a first-time player.",
    "Inspect the initial presentation, exercise at least one meaningful control,",
    "inspect the result visually, and report the highest-impact gameplay or visual improvements.",
  ].join(" ");

const MAX_STEPS = 8;
const MAX_TOOL_CALLS = 16;
const MAX_DURATION_MS = 8 * 60_000;
const MODEL_TURN_TIMEOUT_MS = 2 * 60_000;

function validateEnvironment(): void {
  let parsed: URL;
  try {
    parsed = new URL(GAME_URL);
  } catch {
    throw new Error(`STAGEHAND_GAME_URL is not a valid URL: ${GAME_URL}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("STAGEHAND_GAME_URL must use http:// or https://");
  }
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

interface GameAgentState {
  opened: boolean;
  actions: number;
  snapshots: number;
  latestSnapshot?: StagehandSnapshot;
  session?: StagehandGameSession;
  completed?: string;
}

const GameBrowserTools = () => (
  <>
    <tool
      name="game_open"
      description="Open the configured game URL in a local Stagehand Chromium session"
    />

    <tool
      name="game_press"
      description="Press or hold a keyboard key in the running game"
    >
      <param name="key" type="string" required>
        Key such as ArrowLeft, ArrowRight, Space, w, or Enter
      </param>
      <param name="holdMs" type="integer">
        Optional hold duration in milliseconds, 0-10000
      </param>
    </tool>

    <tool
      name="game_click"
      description="Click viewport coordinates in the running game"
    >
      <param name="x" type="number" required>
        Viewport X coordinate in CSS pixels
      </param>
      <param name="y" type="number" required>
        Viewport Y coordinate in CSS pixels
      </param>
    </tool>

    <tool
      name="game_wait"
      description="Let animations/game state advance without input"
    >
      <param name="ms" type="integer" required>
        Wait duration in milliseconds, 0-10000
      </param>
    </tool>

    <tool
      name="game_snapshot"
      description="Capture the current viewport plus browser diagnostics; the screenshot is attached to the next model turn"
    >
      <param name="label" type="string" required>
        Short filesystem-safe description such as initial, after-jump, or combat
      </param>
    </tool>

    <tool
      name="done"
      description="Finish after visually inspecting both an initial state and a post-interaction state"
    >
      <param name="summary" type="string" required>
        Concise QA conclusion with the highest-impact observed improvements
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

function GameQaPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt>
      <system>{md`
        You are a focused visual QA agent for one browser game.

        The host owns a local Stagehand Chromium session and exposes only semantic game tools.
        You cannot navigate to arbitrary sites. Screenshots returned by game_snapshot are real
        image attachments: inspect the pixels themselves, not merely the textual diagnostics.

        Required workflow:

        1. Call game_open once.
        2. Capture an initial game_snapshot and visually inspect it.
        3. Exercise at least one meaningful control with game_press/game_click. Use game_wait
           when animation or physics needs time to advance.
        4. Capture another game_snapshot after interaction and visually compare the result.
        5. Consider console errors, uncaught page errors, failed network requests, layout,
           readability, affordances, feedback, and gameplay behavior that is actually visible.
        6. Call done only after at least two screenshots and at least one interaction.

        Do not invent observations. If controls are unclear, infer conservatively from the
        screenshot/ARIA information and try common game controls one at a time. Keep visible
        assistant text short; the screenshots and host-tool evidence are the source of truth.
      `}</system>
      <GameBrowserTools />
      <Conversation history={history} />
    </prompt>
  );
}

function textArg(call: CanonicalToolCall, name: string): string {
  return String(call.args[name] ?? "").trim();
}

function numberArg(
  call: CanonicalToolCall,
  name: string,
  fallback = 0,
): number {
  const value = Number(call.args[name]);
  return Number.isFinite(value) ? value : fallback;
}

function snapshotObservation(snapshot: StagehandSnapshot): AgentToolResult {
  const diagnostics = snapshot.diagnostics;
  const lines = [
    `Snapshot: ${snapshot.filename}`,
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    `Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height} @ ${snapshot.viewport.devicePixelRatio}x`,
    `PNG bytes: ${snapshot.bytes}`,
    `Console warnings/errors: ${diagnostics.console.length}`,
    `Uncaught page errors: ${diagnostics.pageErrors.length}`,
    `Failed requests: ${diagnostics.failedRequests.length}`,
  ];

  if (diagnostics.console.length) {
    lines.push(
      "Console:",
      ...diagnostics.console
        .slice(-8)
        .map((entry) => `- [${entry.type}] ${entry.text}`),
    );
  }
  if (diagnostics.pageErrors.length) {
    lines.push(
      "Page errors:",
      ...diagnostics.pageErrors.slice(-6).map((error) => `- ${error}`),
    );
  }
  if (diagnostics.failedRequests.length) {
    lines.push(
      "Failed requests:",
      ...diagnostics.failedRequests
        .slice(-6)
        .map((request) => `- ${request.error}: ${request.url}`),
    );
  }
  if (snapshot.ariaSnapshot.trim()) {
    lines.push(
      "ARIA snapshot (secondary evidence; canvas pixels may not appear here):",
      snapshot.ariaSnapshot,
    );
  }
  lines.push(
    "Inspect the attached screenshot itself before choosing the next action.",
  );

  return {
    content: lines.join("\n"),
    attachments: [
      {
        type: "image",
        path: snapshot.path,
        mimeType: "image/png",
        alt: `Stagehand game screenshot: ${snapshot.filename}`,
      },
    ],
  };
}

async function executeTool(
  call: CanonicalToolCall,
  state: GameAgentState,
  browser: StagehandGameBrowser,
): Promise<AgentToolResult> {
  if (call.name === "game_open") {
    if (state.opened)
      return {
        content: "Game is already open in the current Stagehand session.",
      };
    const opened = await browser.open(GAME_URL, ROOT);
    state.opened = true;
    state.session = opened;
    console.log(`browser> session ${opened.sessionId}`);
    return {
      content: [
        `Stagehand local game session opened: ${opened.title || "(untitled)"}`,
        `URL: ${opened.url}`,
        `Viewport: ${opened.viewport.width}x${opened.viewport.height}`,
        "Take game_snapshot before interacting.",
      ].join("\n"),
    };
  }

  if (!state.opened)
    return {
      content: `${call.name} rejected: call game_open first`,
      isError: true,
    };

  if (call.name === "game_press") {
    const key = textArg(call, "key");
    if (!key) return { content: "game_press requires key", isError: true };
    const holdMs = Math.min(
      10_000,
      Math.max(0, Math.round(numberArg(call, "holdMs", 0))),
    );
    await browser.press(key, holdMs);
    state.actions++;
    return {
      content: holdMs ? `Held ${key} for ${holdMs}ms.` : `Pressed ${key}.`,
    };
  }

  if (call.name === "game_click") {
    const x = numberArg(call, "x", Number.NaN);
    const y = numberArg(call, "y", Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { content: "game_click requires finite x and y", isError: true };
    }
    await browser.click(x, y);
    state.actions++;
    return { content: `Clicked viewport coordinate (${x}, ${y}).` };
  }

  if (call.name === "game_wait") {
    const ms = Math.min(
      10_000,
      Math.max(0, Math.round(numberArg(call, "ms", 500))),
    );
    await browser.wait(ms);
    return { content: `Waited ${ms}ms.` };
  }

  if (call.name === "game_snapshot") {
    const label = textArg(call, "label") || `snapshot-${state.snapshots + 1}`;
    const snapshot = await browser.snapshot(label);
    if (!existsSync(snapshot.path)) {
      return {
        content: `Stagehand screenshot missing after capture: ${snapshot.path}`,
        isError: true,
      };
    }
    state.snapshots++;
    state.latestSnapshot = snapshot;
    return snapshotObservation(snapshot);
  }

  if (call.name === "done") {
    const summary = textArg(call, "summary");
    if (!summary) return { content: "done requires summary", isError: true };
    if (state.snapshots < 2) {
      return {
        content: `done rejected: only ${state.snapshots} screenshot(s); inspect initial and post-interaction states`,
        isError: true,
      };
    }
    if (state.actions < 1) {
      return {
        content: "done rejected: exercise at least one game control first",
        isError: true,
      };
    }
    state.completed = summary;
    return { content: `QA accepted: ${summary}` };
  }

  return { content: `Unknown tool: ${call.name}`, isError: true };
}

function summarizeRun(
  result: AgentRunResult<GameAgentState>,
): Record<string, unknown> {
  return summarizeAgentRun(result, (state) => ({
    browserActions: state.actions,
    screenshots: state.snapshots,
    sessionId: state.session?.sessionId ?? "",
  }));
}

validateEnvironment();
mkdirSync(ROOT, { recursive: true });

console.log(
  [
    "jsx-ai Stagehand local visual game-QA agent",
    "reasoning/vision: Codex",
    "browser: Stagehand V3 local Chromium (deterministic primitives)",
    `game: ${displayUrl(GAME_URL)}`,
    `artifacts: ${ROOT}`,
    "",
    "Stagehand is used only for browser primitives; Codex is the only reasoning agent.",
  ].join("\n"),
);

const browser = new StagehandGameBrowser();
const state: GameAgentState = { opened: false, actions: 0, snapshots: 0 };
let result: AgentRunResult<GameAgentState>;
try {
  result = await measureAgent(
    {
      label: "Stagehand game QA",
      summarizeResult: summarizeRun,
      llm: {
        call: (tree, options) =>
          callLLM(tree, {
            ...options,
            runtime: "codex",
            timeoutMs: MODEL_TURN_TIMEOUT_MS,
          }),
        metadata: () => ({ runtime: "codex" }),
      },
    },
    async ({ call, measureTool, reportRuntimeProgress }) =>
      runAgent({
        state,
        history: [{ role: "user", content: TASK }],
        buildPrompt: (history) => <GameQaPrompt history={history} />,
        executeTool: measureTool((toolCall) =>
          executeTool(toolCall, state, browser),
        ),
        call,
        maxSteps: MAX_STEPS,
        maxToolCalls: MAX_TOOL_CALLS,
        maxDurationMs: MAX_DURATION_MS,
        isComplete: (_response: LLMResponse, _toolResults, context) =>
          Boolean(context.state.completed),
        onEvent: (event) => {
          if (event.type === "text_delta") process.stdout.write(event.delta);
          if (event.type === "runtime_progress")
            reportRuntimeProgress(event.progress, event.context.step + 1);
          if (event.type === "tool_start")
            console.log(`\nexecute> ${event.call.name}`);
          if (event.type === "tool_end" && event.result.attachments?.length) {
            console.log(
              `observe> ${event.result.attachments.map((attachment) => attachment.path).join(", ")}`,
            );
          }
        },
      }),
  );
} finally {
  await browser.close();
}

console.log("\n\nStagehand QA result");
console.log(
  result.state.completed ?? `Agent stopped with reason: ${result.reason}`,
);
if (result.state.latestSnapshot)
  console.log(`Latest screenshot: ${result.state.latestSnapshot.path}`);
