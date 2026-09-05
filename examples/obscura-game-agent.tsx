#!/usr/bin/env bun
// @jsxImportSource jsx-ai
import { resolve } from "node:path";
import { createBrowserGameToolset } from "./_browser-game-backend";
import { runBrowserGameQa } from "./_browser-game-qa";
import { ObscuraGameBrowser } from "./_obscura-game-browser";

const GAME_URL =
  process.env.OBSCURA_GAME_URL?.trim() || "http://127.0.0.1:3001";
const ROOT = resolve(
  process.env.OBSCURA_ARTIFACT_DIR?.trim() || "obscura-game-output",
);
const TASK =
  process.argv[2]?.trim() ||
  [
    "Play-test this browser game as a first-time player.",
    "Inspect the initial presentation, exercise at least one meaningful control,",
    "then verify the result visually and report the highest-impact gameplay or visual improvements.",
  ].join(" ");

const parsed = new URL(GAME_URL);
if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  throw new Error("OBSCURA_GAME_URL must use http:// or https://");

const browser = new ObscuraGameBrowser({
  artifactDir: ROOT,
  allowedOrigin: parsed.origin,
  onEvent: (event) => console.log(`browser> ${JSON.stringify(event)}`),
});

const tools = createBrowserGameToolset(browser);

try {
  await runBrowserGameQa({
    label: "Obscura game QA",
    backend: "obscura",
    browserDescription: "Obscura native Rust engine + Puppeteer Core over CDP",
    gameUrl: GAME_URL,
    artifactDir: ROOT,
    task: TASK,
    tools,
    hostDetails: [
      process.env.OBSCURA_WS_ENDPOINT?.trim()
        ? `obscura: external ${process.env.OBSCURA_WS_ENDPOINT.trim()}`
        : `obscura: managed local process (${process.env.OBSCURA_BIN?.trim() || "obscura"})`,
    ],
  });
} finally {
  await tools.close();
}
