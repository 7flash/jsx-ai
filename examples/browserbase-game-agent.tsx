#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Codex + jsx-ai + Stagehand v4 running on Browserbase.
 *
 * Architecture:
 * - Codex is the only reasoning/vision layer.
 * - jsx-ai owns the agent loop and JSX tool declarations.
 * - Browserbase owns the remote recorded Chromium session.
 * - Stagehand v4 is attached to that Browserbase browser and provides deterministic
 *   browser primitives; Stagehand act/observe/extract/agent are intentionally not used.
 * - Screenshots are returned to Codex as canonical image attachments.
 *
 * Run:
 *   BROWSERBASE_API_KEY=... \
 *   BROWSERBASE_GAME_URL=https://... \
 *   bun run example:browserbase
 */

import { resolve } from "node:path";
import {
  createStagehandBrowserTools,
  launchBrowserbaseStagehand,
  md,
  runAgent,
} from "../src/index";
import type {
  AgentToolResult,
  BrowserEvent,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";

const GAME_URL = process.env.BROWSERBASE_GAME_URL?.trim() || "";
const ROOT = resolve(
  process.env.BROWSERBASE_ARTIFACT_DIR?.trim() || "browserbase-game-output",
);
const TASK =
  process.argv[2]?.trim() ||
  [
    "Play-test this browser game as a first-time player.",
    "Inspect the initial presentation, exercise at least one meaningful control,",
    "inspect the result visually, and report the highest-impact gameplay or visual improvements.",
  ].join(" ");

if (!process.env.BROWSERBASE_API_KEY?.trim()) {
  throw new Error("BROWSERBASE_API_KEY is required for example:browserbase");
}
if (!GAME_URL) {
  throw new Error(
    "BROWSERBASE_GAME_URL is required and must be reachable from the Browserbase session",
  );
}

const parsedGameUrl = new URL(GAME_URL);
if (parsedGameUrl.protocol !== "http:" && parsedGameUrl.protocol !== "https:") {
  throw new Error("BROWSERBASE_GAME_URL must use http:// or https://");
}

interface GameState {
  done: boolean;
  browserActions: number;
  screenshots: number;
  summary?: string;
}

const state: GameState = {
  done: false,
  browserActions: 0,
  screenshots: 0,
};

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

function textArg(call: CanonicalToolCall, name: string): string {
  const value = call.args[name];
  return typeof value === "string" ? value.trim() : "";
}

function observeBrowser(event: BrowserEvent): void {
  if (event.type === "action") state.browserActions++;
  if (event.type === "screenshot") state.screenshots++;
  console.log(`browser> ${JSON.stringify(event)}`);
}

const browser = await launchBrowserbaseStagehand({
  artifactDir: ROOT,
  allowedOrigins: [parsedGameUrl.origin],
  keepAlive: false,
  browserSettings: {
    recordSession: true,
    viewport: { width: 1280, height: 720 },
  },
  onEvent: observeBrowser,
});
const browserTools = createStagehandBrowserTools(browser);
const BrowserTools = browserTools.Tools;

// Host-only observability. These private Browserbase URLs are never returned by a model tool.
const session = await browserTools.sessionInfo({ refresh: true });
console.log(
  [
    "jsx-ai Browserbase + Stagehand v4 visual game-QA agent",
    "reasoning/vision: Codex",
    "browser: Browserbase Chromium + Stagehand v4 deterministic controls",
    `game: ${GAME_URL}`,
    `artifacts: ${ROOT}`,
    session.sessionId
      ? `session: ${session.sessionId}`
      : "session: unavailable",
    session.liveViewUrl
      ? `private Browserbase live view: ${session.liveViewUrl}`
      : "private Browserbase live view: unavailable",
    "",
    "Stagehand is attached to the Browserbase browser. Codex remains the only reasoning/model layer.",
  ].join("\n"),
);

try {
  const result = await runAgent<GameState>({
    history: [
      {
        role: "user",
        content: `${TASK}\n\nOpen the game at ${GAME_URL} and verify conclusions visually.`,
      },
    ],
    state,
    maxSteps: 12,
    maxToolCalls: 36,
    maxDurationMs: 8 * 60_000,
    callOptions: {
      runtime: "codex",
      timeoutMs: 2 * 60_000,
      codex: {
        sandboxMode: "read-only",
        webSearchMode: "disabled",
        approvalPolicy: "never",
      },
    },
    buildPrompt: (history) => (
      <prompt>
        <system>{md`
          You are a focused visual QA agent for one browser game.

          Codex is the only reasoning and vision layer. The host has attached Stagehand v4 to a
          recorded Browserbase Chromium session and exposes deterministic browser controls through
          jsx-ai. Do not assume Stagehand is making decisions for you.

          Required workflow:

          1. Navigate to the configured game URL with browser_navigate.
          2. Inspect browser_snapshot and capture an initial browser_screenshot.
          3. Inspect the screenshot pixels themselves before choosing controls.
          4. Exercise at least one meaningful interaction with browser_action, browser_key, or
             browser_pointer. Prefer snapshot element IDs; use coordinates for canvas-only UI.
          5. Re-inspect state and capture a post-interaction browser_screenshot.
          6. Compare visible results and only report observations supported by screenshots/page state.
          7. Call done only after at least two screenshots and one browser action.

          Keep actions incremental: inspect → act → inspect/verify. The Browserbase live-view URL is
          host-only observability and is intentionally not available to you as a tool result.
        `}</system>
        <BrowserTools />
        <tool
          name="done"
          description="Finish after visual initial/post-interaction verification"
        >
          <param name="summary" type="string" required>
            Concise evidence-based QA conclusion
          </param>
        </tool>
        <Conversation history={history} />
      </prompt>
    ),
    executeTool: async (call): Promise<AgentToolResult> => {
      if (call.name !== "done") return browserTools.executeTool(call);

      const summary = textArg(call, "summary");
      if (!summary) return { content: "done requires summary", isError: true };
      if (state.screenshots < 2) {
        return {
          content: `done rejected: capture at least two screenshots; currently ${state.screenshots}`,
          isError: true,
        };
      }
      if (state.browserActions < 1) {
        return {
          content:
            "done rejected: exercise at least one browser interaction first",
          isError: true,
        };
      }

      state.done = true;
      state.summary = summary;
      return { content: `QA accepted: ${summary}` };
    },
    isComplete: () => state.done,
    onNoToolCalls: (_response, context) =>
      context.step < 11
        ? "Continue with the browser tools. If verification is complete, call done."
        : false,
  });

  console.log(
    `\nstop=${result.reason} steps=${result.steps.length} tools=${result.toolCallsExecuted} actions=${state.browserActions} screenshots=${state.screenshots}`,
  );
  if (state.summary) console.log(`result: ${state.summary}`);
} finally {
  await browserTools.close();
}
