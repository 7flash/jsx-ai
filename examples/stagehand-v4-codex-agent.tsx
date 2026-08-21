#!/usr/bin/env bun
// @jsxImportSource jsx-ai

import { resolve } from "node:path";
import {
  createStagehandBrowserTools,
  launchBrowserbaseStagehand,
  launchLocalStagehand,
  md,
  runAgent,
} from "../src/index";
import type {
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";

const START_URL = process.env.BROWSER_URL?.trim() || "https://example.com";
const BROWSER_MODE =
  process.env.BROWSER_MODE?.trim().toLowerCase() === "local"
    ? "local"
    : "browserbase";
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
const browser =
  BROWSER_MODE === "local"
    ? await launchLocalStagehand({
        artifactDir: ARTIFACT_DIR,
        allowedOrigins: [initialOrigin],
        browserOptions: {
          headless: process.env.BROWSER_HEADLESS?.trim() !== "false",
        },
        onEvent: (event) => console.log(`browser> ${JSON.stringify(event)}`),
      })
    : await launchBrowserbaseStagehand({
        artifactDir: ARTIFACT_DIR,
        allowedOrigins: [initialOrigin],
        keepAlive: false,
        onEvent: (event) => console.log(`browser> ${JSON.stringify(event)}`),
      });
const browserTools = createStagehandBrowserTools(browser);
const BrowserTools = browserTools.Tools;
const state: State = { done: false };

const session = await browser.sessionInfo();
console.log(
  [
    "jsx-ai Stagehand v4 + Codex browser agent",
    `browser mode: ${BROWSER_MODE}`,
    `start: ${START_URL}`,
    `artifacts: ${ARTIFACT_DIR}`,
    session.sessionId
      ? `session: ${session.sessionId}`
      : "session: unavailable",
    session.liveViewUrl
      ? `private live view: ${session.liveViewUrl}`
      : "private live view: unavailable",
    "",
    "Codex is the only reasoning/vision layer. Stagehand is used for deterministic browser primitives.",
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
  await browserTools.close();
}
