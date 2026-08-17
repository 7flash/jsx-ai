#!/usr/bin/env bun
/**
 * User-visible text streaming with either jsx-ai runtime.
 *
 * Configure outside the example:
 *   JSX_AI_RUNTIME=codex   -> Codex app-server text deltas, ChatGPT/Codex auth
 *   JSX_AI_RUNTIME=api     -> provider SSE/text deltas, JSX_AI_MODEL required
 *
 * No provider/runtime/model branch lives in this file.
 */

import { streamLLM } from "../src/index";
import { measure } from "./_example-observability";

interface StreamSummary {
  chunks: number;
  characters: number;
  firstChunkMs: number | null;
  elapsedMs: number;
}

console.log(`jsx-ai text stream
runtime/model: resolved by jsx-ai (JSX_AI_RUNTIME / JSX_AI_MODEL)
stream: assistant text deltas; chunk boundaries are transport boundaries, not guaranteed tokenizer tokens
`);

const startedAt = Date.now();
let firstChunkAt: number | undefined;
let chunks = 0;
let characters = 0;

const summary = await measure.assert(
  {
    label: "streamLLM text generation",
    result: (value: StreamSummary) => value,
  },
  async () => {
    process.stdout.write("assistant> ");

    for await (const chunk of streamLLM(
      [
        {
          role: "system",
          content: "Be concise, concrete, and use plain text.",
        },
        {
          role: "user",
          content:
            "Explain in three short bullets why JSX can be a useful DSL for structured LLM calls.",
        },
      ],
      { timeoutMs: 2 * 60_000 },
    )) {
      firstChunkAt ??= Date.now();
      chunks += 1;
      characters += chunk.length;
      process.stdout.write(chunk);
    }

    process.stdout.write("\n");
    return {
      chunks,
      characters,
      firstChunkMs:
        firstChunkAt === undefined ? null : firstChunkAt - startedAt,
      elapsedMs: Date.now() - startedAt,
    };
  },
);

if (summary === null)
  throw new Error("Text stream failed; inspect the trace above.");
