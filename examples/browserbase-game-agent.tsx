#!/usr/bin/env bun
// @jsxImportSource jsx-ai
import { resolve } from "node:path";
import { launchBrowserbaseStagehand } from "../src/index";
import { createBrowserGameToolset } from "./_browser-game-backend";
import { runBrowserGameQa } from "./_browser-game-qa";

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

const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
if (!apiKey)
  throw new Error("BROWSERBASE_API_KEY is required for example:browserbase");
if (!GAME_URL)
  throw new Error(
    "BROWSERBASE_GAME_URL is required and must be reachable from Browserbase",
  );
const parsed = new URL(GAME_URL);
if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  throw new Error("BROWSERBASE_GAME_URL must use http:// or https://");

const controller = await launchBrowserbaseStagehand({
  apiKey,
  artifactDir: ROOT,
  allowedOrigins: [parsed.origin],
  keepAlive: false,
  browserSettings: {
    recordSession: true,
    viewport: { width: 1280, height: 720 },
  },
  onEvent: (event) => console.log(`browser> ${JSON.stringify(event)}`),
});
const tools = createBrowserGameToolset(controller);

try {
  const session = await controller.sessionInfo({ refresh: true });
  await runBrowserGameQa({
    label: "Browserbase game QA",
    backend: "browserbase",
    browserDescription:
      "Browserbase Chromium + Stagehand v4 deterministic controls",
    gameUrl: GAME_URL,
    artifactDir: ROOT,
    task: TASK,
    tools,
    hostDetails: [
      session.sessionId
        ? `session: ${session.sessionId}`
        : "session: unavailable",
      session.liveViewUrl
        ? `private Browserbase live view: ${session.liveViewUrl}`
        : "private Browserbase live view: unavailable",
    ],
    systemDetails:
      "The Browserbase live-view URL is host-only observability and is never exposed as a model tool result.",
  });
} finally {
  await tools.close();
}
