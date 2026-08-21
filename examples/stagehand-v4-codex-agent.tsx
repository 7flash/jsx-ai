#!/usr/bin/env bun
// @jsxImportSource jsx-ai

import { resolve } from "node:path";
import {
  createLocalStagehandBrowserTools,
  md,
  runAgent,
  startLocalBrowserScreencast,
} from "../src/index";
import type {
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";

const START_URL = process.env.BROWSER_URL?.trim() || "https://example.com";
const TASK =
  process.argv[2]?.trim() ||
  "Inspect the page, explain what it offers, interact only when useful, and verify important visual changes with screenshots.";
const ARTIFACT_DIR = resolve(
  process.env.BROWSER_ARTIFACT_DIR?.trim() || "browser-agent-output",
);

interface State {
  done: boolean;
  summary?: string;
}

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

const initialOrigin = new URL(START_URL).origin;
const headless = ["1", "true", "yes"].includes(
  process.env.BROWSER_HEADLESS?.trim().toLowerCase() || "",
);
const browserTools = await createLocalStagehandBrowserTools({
  artifactDir: ARTIFACT_DIR,
  allowedOrigins: [initialOrigin],
  browserOptions: { headless },
  onEvent: (event) => console.log(`browser> ${JSON.stringify(event)}`),
});
const BrowserTools = browserTools.Tools;
const state: State = { done: false };
const screencastEnabled = !["0", "false", "no"].includes(
  process.env.BROWSER_SCREENCAST?.trim().toLowerCase() || "",
);
let screencast:
  Awaited<ReturnType<typeof startLocalBrowserScreencast>> | undefined;
try {
  screencast = screencastEnabled
    ? await startLocalBrowserScreencast(browserTools.controller, {
        port: Number(process.env.BROWSER_SCREENCAST_PORT || 0),
        fps: Number(process.env.BROWSER_SCREENCAST_FPS || 4),
        quality: Number(process.env.BROWSER_SCREENCAST_QUALITY || 72),
      })
    : undefined;
} catch (error) {
  await browserTools.close();
  throw error;
}

console.log(
  [
    "jsx-ai local Stagehand v4 + Codex browser agent",
    "browser: local Chromium + Stagehand v4 deterministic controls",
    `window: ${headless ? "headless" : "visible (live local view)"}`,
    `start: ${START_URL}`,
    `artifacts: ${ARTIFACT_DIR}`,
    `screencast: ${screencast?.url ?? "disabled"}`,
    "",
    "The screencast is a loopback-only host viewer; its JPEG frames are not sent to Codex.",
    "No Browserbase API key or Playwright sidecar is used.",
    "Codex is the only reasoning/vision layer; screenshots are returned as image attachments.",
  ].join("\n"),
);

try {
  const result = await runAgent<State>({
    history: [
      {
        role: "user",
        content: `${TASK}\n\nStart by navigating to ${START_URL}.`,
      },
    ],
    state,
    maxSteps: 16,
    maxToolCalls: 48,
    maxDurationMs: 10 * 60_000,
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
          You are a browser-operating agent. Codex is your reasoning and vision layer; the host's
          Stagehand v4 tools are deterministic browser controls only.

          Browser workflow:

          - Navigate with browser_navigate.
          - Call browser_snapshot to understand DOM/accessibility state and obtain element IDs.
          - Use browser_action with IDs from the latest snapshot for normal DOM interactions.
          - Use browser_pointer only when the target is genuinely visual/canvas-only and you have
            inspected a recent screenshot.
          - Call browser_screenshot whenever visual appearance matters. The resulting PNG is a real
            image attachment; inspect its pixels before making visual claims or choosing coordinates.
          - Re-snapshot after navigation or meaningful DOM changes because element IDs are invalidated.
          - Keep actions incremental: inspect → act → inspect/verify.
          - Never claim an interaction succeeded merely because the tool returned; verify consequential
            changes using browser_snapshot or browser_screenshot.
          - When the user's task is complete, call done with a concise evidence-based summary.
        `}</system>
        <BrowserTools />
        <tool
          name="done"
          description="Finish the browser task after verifying the result"
        >
          <param name="summary" type="string" required>
            Concise final result and the evidence used to verify it
          </param>
        </tool>
        <Conversation history={history} />
      </prompt>
    ),
    executeTool: async (call): Promise<AgentToolResult> => {
      if (call.name === "done") {
        const summary = textArg(call, "summary");
        if (!summary)
          return { content: "done requires summary", isError: true };
        state.done = true;
        state.summary = summary;
        return { content: `Completion recorded: ${summary}` };
      }
      return browserTools.executeTool(call);
    },
    isComplete: () => state.done,
    onNoToolCalls: (_response, context) =>
      context.step < 15
        ? "Continue using the browser tools. If the task is complete, call done."
        : false,
  });

  console.log(
    `\nstop=${result.reason} steps=${result.steps.length} tools=${result.toolCallsExecuted}`,
  );
  if (result.state.summary) console.log(`result: ${result.state.summary}`);
} finally {
  await screencast?.close();
  await browserTools.close();
}
