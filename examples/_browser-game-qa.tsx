// @jsxImportSource jsx-ai
import { md, runAgent } from "../src/index";
import type {
  AgentRunResult,
  CanonicalToolCall,
  ExtractedMessage,
} from "../src/index";
import {
  measureAgent,
  type MeasuredAgentScope,
} from "./_example-observability";
import {
  BROWSER_GAME_TOOL_NAMES,
  isBrowserGameActionToolName,
  type BrowserGameToolset,
} from "./_browser-game-backend";

export interface BrowserGameQaState {
  done: boolean;
  browserActions: number;
  screenshots: number;
  summary?: string;
}

export interface BrowserGameQaOptions {
  label: string;
  backend: string;
  browserDescription: string;
  gameUrl: string;
  artifactDir: string;
  task: string;
  tools: BrowserGameToolset;
  hostDetails?: readonly string[];
  systemDetails?: string;
  maxSteps?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
  modelTurnTimeoutMs?: number;
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

function BrowserTools() {
  return (
    <>
      <tool
        name="browser_navigate"
        description="Navigate the browser to an allowed URL"
      >
        <param name="url" type="string" required>
          Absolute http(s) URL on the configured game origin
        </param>
      </tool>
      <tool
        name="browser_snapshot"
        description="Inspect page structure and obtain temporary element IDs for browser_action"
      />
      <tool
        name="browser_action"
        description="Act on an element ID from the latest browser_snapshot"
      >
        <param
          name="op"
          type="string"
          required
          enum={["click", "hover", "fill", "type", "select"]}
        >
          Interaction to perform
        </param>
        <param name="id" type="string" required>
          Element ID from the latest snapshot
        </param>
        <param name="value" type="string">
          Value for fill, type, or select
        </param>
        <param name="delayMs" type="integer">
          Optional per-character delay for type
        </param>
      </tool>
      <tool
        name="browser_pointer"
        description="Click viewport coordinates for canvas or visual-only controls"
      >
        <param name="x" type="number" required>
          Viewport X coordinate in CSS pixels
        </param>
        <param name="y" type="number" required>
          Viewport Y coordinate in CSS pixels
        </param>
      </tool>
      <tool
        name="browser_key"
        description="Press a keyboard key or key combination"
      >
        <param name="key" type="string" required>
          Key such as Enter, Space, ArrowLeft, or w
        </param>
        <param name="delayMs" type="integer">
          Optional key-down duration from 0 to 10000ms
        </param>
      </tool>
      <tool
        name="browser_wait"
        description="Wait briefly for animation or asynchronous page state"
      >
        <param name="ms" type="integer" required>
          Wait duration from 0 to 10000ms
        </param>
      </tool>
      <tool
        name="browser_back"
        description="Navigate back in browser history"
      />
      <tool
        name="browser_screenshot"
        description="Capture a PNG and return it as an image attachment for visual inspection"
      >
        <param name="label" type="string">
          Short artifact label
        </param>
        <param name="fullPage" type="boolean">
          Capture the full document instead of the viewport
        </param>
      </tool>
    </>
  );
}

function textArg(call: CanonicalToolCall, name: string): string {
  const value = call.args[name];
  return typeof value === "string" ? value.trim() : "";
}

async function runMeasured(
  scope: MeasuredAgentScope,
  options: BrowserGameQaOptions,
  state: BrowserGameQaState,
): Promise<AgentRunResult<BrowserGameQaState>> {
  const maxSteps = options.maxSteps ?? 12;
  const executeTool = scope.measureTool(
    async (call: CanonicalToolCall) => {
      if (call.name === "done") {
        const summary = textArg(call, "summary");
        if (!summary)
          return { content: "done requires summary", isError: true };
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
      }

      const result = await options.tools.executeTool(call);
      if (!result.isError) {
        if (call.name === "browser_screenshot") state.screenshots++;
        if (isBrowserGameActionToolName(call.name)) state.browserActions++;
      }
      return result;
    },
    { metadata: () => ({ browser: options.backend }) },
  );

  return runAgent<BrowserGameQaState>({
    history: [
      {
        role: "user",
        content: `${options.task}\n\nOpen the game at ${options.gameUrl} and verify conclusions visually.`,
      },
    ],
    state,
    maxSteps,
    maxToolCalls: options.maxToolCalls ?? 36,
    maxDurationMs: options.maxDurationMs ?? 8 * 60_000,
    call: scope.call,
    callOptions: {
      runtime: "codex",
      timeoutMs: options.modelTurnTimeoutMs ?? 2 * 60_000,
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

          Codex is the only reasoning and vision layer. The host controls ${options.browserDescription}
          through deterministic browser operations. The browser backend does not make decisions for you.
          ${options.systemDetails ?? ""}

          Required workflow:
          1. Navigate to the configured game URL with browser_navigate.
          2. Inspect browser_snapshot and capture an initial browser_screenshot.
          3. Inspect the screenshot pixels themselves before choosing controls.
          4. Exercise at least one meaningful interaction using browser_action, browser_key, or browser_pointer.
          5. Re-inspect state and capture a post-interaction browser_screenshot.
          6. Compare visible results and only report observations supported by screenshots/page state.
          7. Call done only after at least two screenshots and one browser action.

          Element IDs are temporary. Re-snapshot after navigation or meaningful DOM changes.
          Keep actions incremental: inspect → act → inspect/verify.
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
    executeTool,
    isComplete: () => state.done,
    onNoToolCalls: (_response, context) =>
      context.step < maxSteps - 1
        ? "Continue with the browser tools. If verification is complete, call done."
        : false,
    onEvent: (event) => {
      if (event.type === "runtime_progress")
        scope.reportRuntimeProgress(event.progress, event.context.step + 1);
      if (event.type === "text_delta") process.stdout.write(event.delta);
    },
  });
}

export async function runBrowserGameQa(
  options: BrowserGameQaOptions,
): Promise<AgentRunResult<BrowserGameQaState>> {
  const declaredTools = [...options.tools.toolNames];
  if (
    declaredTools.length !== BROWSER_GAME_TOOL_NAMES.length ||
    declaredTools.some((name, index) => name !== BROWSER_GAME_TOOL_NAMES[index])
  ) {
    throw new Error(
      `${options.backend} browser backend does not implement the canonical browser tool contract`,
    );
  }

  const state: BrowserGameQaState = {
    done: false,
    browserActions: 0,
    screenshots: 0,
  };

  console.log(
    [
      `jsx-ai ${options.backend} visual game-QA agent`,
      "reasoning/vision: Codex",
      `browser: ${options.browserDescription}`,
      `game: ${options.gameUrl}`,
      `artifacts: ${options.artifactDir}`,
      ...(options.hostDetails ?? []),
      "",
      "The browser backend is execution-only; jsx-ai/Codex remains the agent.",
    ].join("\n"),
  );

  const result = await measureAgent<BrowserGameQaState>(
    {
      label: options.label,
      metadata: {
        browser: options.backend,
        gameOrigin: new URL(options.gameUrl).origin,
      },
      llm: { metadata: () => ({ browser: options.backend }) },
      summarizeState: (next) => ({
        actions: next.browserActions,
        screenshots: next.screenshots,
        completed: next.done,
      }),
    },
    (scope) => runMeasured(scope, options, state),
  );

  console.log(
    `\nstop=${result.reason} steps=${result.steps.length} tools=${result.toolCallsExecuted} actions=${state.browserActions} screenshots=${state.screenshots}`,
  );
  if (state.summary) console.log(`result: ${state.summary}`);
  return result;
}
