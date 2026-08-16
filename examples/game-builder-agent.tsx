#!/usr/bin/env bun
/**
 * Iterative game-building agent.
 *
 * Phase 1: creates a playable HTML5 Canvas game.
 * Phase 2: reads the result and improves mechanics/polish.
 * Phase 3: rewrites the renderer with Three.js while preserving gameplay.
 *
 * Run:
 *   GAME_MODEL=gemini-2.5-flash bun run examples/game-builder-agent.tsx ./game-output
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { callLLM, md } from "jsx-ai";
import type { ExtractedMessage, ToolCall } from "jsx-ai";

const MODEL = process.env.GAME_MODEL || "gemini-3-flash-preview";
const ROOT = resolve(process.argv[2] || "game-output");
mkdirSync(ROOT, { recursive: true });

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

function executeTool(call: ToolCall): ExtractedMessage {
  try {
    switch (call.name) {
      case "write_file": {
        const path = safePath(String(call.args.path || ""));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, String(call.args.content || ""), "utf-8");
        return toolResult(
          call,
          `Wrote ${relative(ROOT, path)} (${String(call.args.content || "").length} chars).`,
        );
      }
      case "read_file": {
        const path = safePath(String(call.args.path || ""));
        return toolResult(call, readFileSync(path, "utf-8"));
      }
      case "list_files":
        return toolResult(call, JSON.stringify(listFiles(), null, 2));
      case "phase_done":
        return toolResult(
          call,
          `Phase accepted: ${String(call.args.summary || "")}`,
        );
      default:
        return toolResult(call, `Unknown tool: ${call.name}`, true);
    }
  } catch (error: any) {
    return toolResult(call, error?.message || String(error), true);
  }
}

function toolResult(
  call: ToolCall,
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

function promptTree(history: ExtractedMessage[]) {
  return (
    <prompt model={MODEL} strategy="hybrid" temperature={0.2} maxTokens={14000}>
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
        >
          {message.content}
        </message>
      ))}
    </prompt>
  );
}

async function runPhase(
  history: ExtractedMessage[],
  goal: string,
  maxSteps = 8,
): Promise<void> {
  history.push({ role: "user", content: goal });

  for (let step = 0; step < maxSteps; step++) {
    const result = await callLLM(promptTree(history), {
      model: MODEL,
      strategy: "hybrid",
      retries: 3,
      timeoutMs: 90_000,
    });

    history.push({
      role: "assistant",
      content: result.text || "",
      toolCalls: result.toolCalls,
    });
    if (!result.toolCalls.length) {
      history.push({
        role: "user",
        content:
          "Continue by using the available tools. Call phase_done only after the phase is implemented.",
      });
      continue;
    }

    const done = result.toolCalls.some((call) => call.name === "phase_done");
    for (const call of result.toolCalls) history.push(executeTool(call));
    if (done) return;
  }
  throw new Error(`Phase exceeded ${maxSteps} model/tool iterations`);
}

const history: ExtractedMessage[] = [];

await runPhase(
  history,
  md`
    PHASE 1 — BUILD THE GAME.
    Create a complete, fun arcade game using plain HTML/CSS/JavaScript and the HTML5 Canvas 2D API.
    Requirements: keyboard controls, score, restart flow, increasing challenge, clear visual feedback,
    and no build step. Keep external dependencies at zero. Create all required files.
  `,
);

await runPhase(
  history,
  md`
    PHASE 2 — ITERATE ON THE EXISTING CANVAS GAME.
    Inspect the files you built and substantially improve the game rather than merely restyling it.
    Improve game feel, progression, feedback, UI, effects, and code organization while keeping it playable.
    Preserve the strongest mechanics from phase 1 and fix any obvious implementation weaknesses.
  `,
);

await runPhase(
  history,
  md`
    PHASE 3 — REWRITE THE PRESENTATION WITH THREE.JS.
    Inspect the current project, then migrate the visual renderer from Canvas 2D to Three.js using an ES-module CDN import
    so the project still has no package-install/build step. Preserve and improve the gameplay/state logic from the previous
    phases. Use real 3D scene/camera/lighting/geometry where it improves the experience, keep responsive controls/UI,
    and leave the project in a coherent runnable final state. Remove obsolete Canvas-2D rendering code where appropriate.
  `,
);

console.log(`Game project complete: ${ROOT}`);
console.log(
  listFiles()
    .map((file) => `  ${file}`)
    .join("\n"),
);
