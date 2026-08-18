#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Codex-only image-generation agent.
 *
 * This example deliberately demonstrates a Codex built-in capability rather
 * than a portable host tool. Codex generates a raster image with its built-in
 * `$imagegen` / image_gen tool. The host captures the completed image payload,
 * saves it into the example workspace, then returns that file as a canonical
 * image attachment so the next agent step can visually inspect it.
 *
 * Run:
 *   bun run example:image
 *   bun run example:image ./image-agent-output "Create a friendly 2D robot companion sprite concept"
 *
 * Requires:
 *   bun add @openai/codex
 *   bunx @openai/codex login
 */

import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
  LLMResponse,
} from "../src/index";
import {
  createRuntimeProgressReporter,
  measure,
  summarizeResponse,
  summarizeToolCall,
  truncate,
  type MeasureFn,
} from "./_example-observability";

const ROOT = resolve(process.argv[2] || "image-agent-output");
const TASK =
  process.argv[3] ||
  [
    "Create a polished 2D game character concept for a small clockwork fox companion.",
    "Centered full-body subject, readable silhouette, warm brass and copper materials,",
    "subtle teal energy accents, plain neutral background, no text, no logo, no watermark.",
  ].join(" ");

const MAX_STEPS = 4;
const MAX_TOOL_CALLS = 6;
const MAX_DURATION_MS = 10 * 60_000;
const MODEL_TURN_TIMEOUT_MS = 5 * 60_000;

mkdirSync(ROOT, { recursive: true });

interface CapturedImage {
  id: string;
  path: string;
  relativePath: string;
  bytes: number;
  revisedPrompt?: string;
  source: "result" | "savedPath";
}

interface ImageAgentState {
  generationCount: number;
  seenGenerationIds: Set<string>;
  latestImage?: CapturedImage;
  reviewedGenerationId?: string;
  completed?: {
    path: string;
    summary: string;
  };
}

const ImageAgentTools = () => (
  <>
    <tool
      name="review_latest_image"
      description="Ask the host to attach the most recently generated Codex image to the next model step for visual review"
    />

    <tool
      name="done"
      description="Finish only after visually reviewing the latest generated image"
    >
      <param name="summary" type="string" required>
        Concise description of the accepted image and why it fits the requested
        game asset
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

function ImageAgentPrompt({
  history,
}: {
  history: readonly ExtractedMessage[];
}) {
  return (
    <prompt strategy="hybrid">
      <system>{md`
        You are a small image-asset agent running inside the Codex runtime.

        This example intentionally uses Codex's built-in $imagegen skill / image_gen
        capability. Use that built-in raster image generator for the requested asset.
        Do not substitute SVG, Canvas, PIL, PowerShell drawing, or other code-generated
        placeholder art.

        Workflow for every candidate:

        1. Generate the image with the built-in image generator.
        2. Then call review_latest_image. The host application captures the completed
           image-generation result itself, so do not copy/move files with shell commands.
        3. On the next model step, visually inspect the image attachment returned by the host.
        4. If it is good enough, call done. If it needs improvement, generate a revised
           candidate with image_gen and call review_latest_image again.

        Never call done for a candidate that has not been returned by review_latest_image.
        Keep visible assistant text short; the purpose of this example is the image loop.
      `}</system>
      <ImageAgentTools />
      <Conversation history={history} />
    </prompt>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completedImageGenerationItems(
  response: LLMResponse,
): Record<string, unknown>[] {
  if (!isRecord(response.raw) || !Array.isArray(response.raw.items)) return [];
  return response.raw.items.filter(
    (item) =>
      isRecord(item) &&
      item.type === "imageGeneration" &&
      item.status === "completed",
  ) as Record<string, unknown>[];
}

function captureNewGeneratedImage(
  response: LLMResponse,
  state: ImageAgentState,
): CapturedImage | undefined {
  const candidates = completedImageGenerationItems(response).filter(
    (item) =>
      typeof item.id === "string" && !state.seenGenerationIds.has(item.id),
  );

  const item = candidates.at(-1);
  if (!item || typeof item.id !== "string") return undefined;

  const generation = ++state.generationCount;
  const target = resolve(
    ROOT,
    `candidate-${String(generation).padStart(2, "0")}.png`,
  );
  let source: CapturedImage["source"] | undefined;

  if (typeof item.result === "string" && item.result.trim()) {
    const bytes = Buffer.from(item.result.trim(), "base64");
    if (bytes.length > 0) {
      writeFileSync(target, bytes);
      source = "result";
    }
  }

  if (
    !source &&
    typeof item.savedPath === "string" &&
    existsSync(item.savedPath)
  ) {
    copyFileSync(item.savedPath, target);
    source = "savedPath";
  }

  state.seenGenerationIds.add(item.id);
  if (!source || !existsSync(target)) {
    throw new Error(
      "Codex reported a completed imageGeneration item but exposed neither a usable base64 result nor a readable savedPath.",
    );
  }

  const captured: CapturedImage = {
    id: item.id,
    path: target,
    relativePath: relative(ROOT, target),
    bytes: statSync(target).size,
    ...(typeof item.revisedPrompt === "string" && item.revisedPrompt.trim()
      ? { revisedPrompt: item.revisedPrompt.trim() }
      : {}),
    source,
  };
  state.latestImage = captured;
  return captured;
}

function executeTool(
  call: CanonicalToolCall,
  state: ImageAgentState,
): AgentToolResult {
  if (call.name === "review_latest_image") {
    const image = state.latestImage;
    if (!image) {
      return {
        content:
          "No completed Codex image generation has been captured yet. Generate an image with the built-in image_gen tool first.",
        isError: true,
      };
    }

    state.reviewedGenerationId = image.id;
    return {
      content: [
        `Visual review candidate: ${image.relativePath}`,
        `Bytes: ${image.bytes}`,
        image.revisedPrompt ? `Revised prompt: ${image.revisedPrompt}` : "",
        "Inspect the attached image itself before deciding whether to accept or regenerate it.",
      ]
        .filter(Boolean)
        .join("\n"),
      attachments: [
        {
          type: "image",
          path: image.relativePath,
          mimeType: "image/png",
          alt: "Latest Codex-generated game asset candidate",
        },
      ],
    };
  }

  if (call.name === "done") {
    const image = state.latestImage;
    const summary = String(call.args.summary ?? "").trim();
    if (!image)
      return {
        content: "done rejected: no image has been generated",
        isError: true,
      };
    if (state.reviewedGenerationId !== image.id) {
      return {
        content:
          "done rejected: review the latest generated image with review_latest_image first",
        isError: true,
      };
    }
    if (!summary)
      return { content: "done requires a non-empty summary", isError: true };

    state.completed = { path: image.relativePath, summary };
    return { content: `Accepted ${image.relativePath}: ${summary}` };
  }

  return { content: `Unknown tool: ${call.name}`, isError: true };
}

function summarizeToolResult(result: AgentToolResult): Record<string, unknown> {
  return {
    error: result.isError ?? false,
    resultChars: result.content.length,
    attachments: result.attachments?.map((attachment) => attachment.path) ?? [],
    preview: truncate(result.content.replace(/\s+/g, " "), 180),
  };
}

function summarizeRun(
  result: AgentRunResult<ImageAgentState>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    hostToolCalls: result.toolCallsExecuted,
    generations: result.state.generationCount,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
    accepted: result.state.completed?.path ?? "",
  };
}

console.log(
  [
    "jsx-ai Codex image-generation agent",
    "runtime: codex (intentional; this example demonstrates Codex's built-in image_gen capability)",
    `workspace: ${ROOT}`,
    `task: ${TASK}`,
    "",
    "Flow: Codex image_gen → host captures PNG → review_latest_image returns attachment → Codex visually reviews → done",
  ].join("\n"),
);

const state: ImageAgentState = {
  generationCount: 0,
  seenGenerationIds: new Set<string>(),
};

const result = await measure.assert(
  {
    label: "Codex image agent",
    workspace: ROOT,
    result: summarizeRun,
  },
  async (trace: MeasureFn) => {
    let modelStep = 0;
    let activeTextStep = -1;
    const reportRuntimeProgress = createRuntimeProgressReporter();

    const measuredCall: typeof callLLM = async (tree, options) => {
      const step = ++modelStep;
      const response = await trace(
        {
          label: `Model step ${step}`,
          result: summarizeResponse,
        },
        () => callLLM(tree, options),
      );
      if (response === null)
        throw new Error(`Model step ${step} failed; inspect the trace above.`);
      return response;
    };

    return runAgent({
      state,
      history: [
        {
          role: "user",
          content: `$imagegen ${TASK}`,
        },
      ],
      buildPrompt: (history) => <ImageAgentPrompt history={history} />,
      executeTool: async (call) => {
        const toolResult = await trace(
          {
            label: `Host tool — ${call.name}`,
            ...summarizeToolCall(call),
            result: summarizeToolResult,
          },
          async () => executeTool(call, state),
        );
        if (toolResult === null)
          throw new Error(`Host tool ${call.name} failed inside the trace.`);
        return toolResult;
      },
      call: measuredCall,
      callOptions: {
        runtime: "codex",
        timeoutMs: MODEL_TURN_TIMEOUT_MS,
        codex: {
          workingDirectory: ROOT,
          sandboxMode: "read-only",
          approvalPolicy: "never",
          webSearchMode: "disabled",
        },
      },
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      maxDurationMs: MAX_DURATION_MS,
      isComplete: (_response, _toolResults, context) =>
        Boolean(context.state.completed),
      onNoToolCalls: (_response, context) => {
        if (!context.state.latestImage) {
          return "Use the Codex built-in $imagegen/image_gen capability to generate the requested raster image, then call review_latest_image.";
        }
        return "Call review_latest_image for the latest candidate, then visually inspect it and either regenerate or call done.";
      },
      onEvent: (event) => {
        if (event.type === "runtime_progress") {
          reportRuntimeProgress(event.progress, event.context.step + 1);
          return;
        }

        if (event.type === "text_delta") {
          if (activeTextStep !== event.context.step) {
            activeTextStep = event.context.step;
            process.stdout.write("\nassistant> ");
          }
          process.stdout.write(event.delta);
          return;
        }

        if (event.type === "model_end") {
          if (activeTextStep === event.context.step) process.stdout.write("\n");
          const captured = captureNewGeneratedImage(event.response, state);
          if (captured) {
            console.log(
              `image> captured ${captured.relativePath} (${captured.bytes} bytes, source=${captured.source})`,
            );
          }
          return;
        }

        if (event.type === "tool_start") {
          console.log(`host> ${event.call.name} started`);
          return;
        }

        if (event.type === "tool_end") {
          console.log(
            `host> ${event.call.name} ${event.result.isError ? "failed" : "finished"}`,
          );
          return;
        }

        if (event.type === "stop") {
          console.log(`agent> stopped (${event.reason})`);
        }
      },
    });
  },
);

if (result === null)
  throw new Error("Codex image agent failed; inspect the trace above.");
if (result.reason !== "completed" || !result.state.completed) {
  throw new Error(
    `Image agent stopped with ${result.reason} after ${result.steps.length} model step(s). ` +
      "If the trace says image_gen is unavailable, update Codex and confirm your ChatGPT-authenticated Codex session exposes built-in image generation.",
  );
}

const accepted = result.state.latestImage;
console.log("\nAccepted image");
console.log(`Path: ${resolve(ROOT, result.state.completed.path)}`);
console.log(`Bytes: ${accepted?.bytes ?? 0}`);
console.log(`Generations: ${result.state.generationCount}`);
console.log(`Summary: ${result.state.completed.summary}`);
