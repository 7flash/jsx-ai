import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { runAgent } from "../agent";
import { isJsxAiError } from "../errors";
import { normalizePromptIR } from "../ir";
import { Fragment, jsx } from "../jsx-runtime";
import { callLLM } from "../llm";
import type { ExtractedMessage } from "../types";
import { __setCodexAppServerLauncherForTests } from "./codex-app-server";
import { callCodexRuntime, type CodexRuntimeOptions } from "./codex";

interface FakeTurn {
  response?: string;
  deltas?: readonly string[];
  progress?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
  block?: boolean;
}

interface FakeServerOptions {
  turns: readonly FakeTurn[];
}

class FakeAppServerProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly requests: Array<{ id?: number; method?: string; params?: unknown }> =
    [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private turn = 0;
  private thread = 0;

  constructor(private readonly options: FakeServerOptions) {
    super();
    this.stdin = new Writable({
      write: (
        chunk: unknown,
        _encoding: unknown,
        callback: (error?: Error | null) => void,
      ) => {
        try {
          this.handleRequest(String(chunk).trim());
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    this.stdin.once("finish", () => this.finish());
  }

  private send(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  private handleRequest(line: string): void {
    if (!line) return;
    const message = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: unknown;
    };
    this.requests.push(message);

    if (message.method === "initialize" && typeof message.id === "number") {
      this.send({ id: message.id, result: { codexHome: "C:/fake/.codex" } });
      return;
    }
    if (message.method === "thread/start" && typeof message.id === "number") {
      const threadId = `thread_${++this.thread}`;
      this.send({ id: message.id, result: { thread: { id: threadId } } });
      return;
    }
    if (message.method !== "turn/start" || typeof message.id !== "number")
      return;

    const params = message.params as { threadId?: string } | undefined;
    const threadId = params?.threadId ?? `thread_${this.thread}`;
    const turnId = `turn_${++this.turn}`;
    const config =
      this.options.turns[this.turn - 1] ?? this.options.turns.at(-1);
    if (!config)
      throw new Error(`No fake turn configured for turn ${this.turn}`);

    this.send({
      id: message.id,
      result: { turn: { id: turnId, status: "inProgress" } },
    });
    if (config.block) return;

    queueMicrotask(() => {
      this.send({ method: "turn/started", params: { threadId, turnId } });
      if (config.progress) {
        this.send({
          method: "item/reasoning/summaryTextDelta",
          params: {
            threadId,
            turnId,
            itemId: `reason_${this.turn}`,
            delta: config.progress,
          },
        });
      }
      if (config.usage) {
        const inputTokens = config.usage.inputTokens ?? 0;
        const cachedInputTokens = config.usage.cachedInputTokens ?? 0;
        const outputTokens = config.usage.outputTokens ?? 0;
        const reasoningOutputTokens = config.usage.reasoningOutputTokens ?? 0;
        this.send({
          method: "thread/tokenUsage/updated",
          params: {
            threadId,
            turnId,
            tokenUsage: {
              last: {
                inputTokens,
                cachedInputTokens,
                outputTokens,
                reasoningOutputTokens,
                totalTokens:
                  config.usage.totalTokens ?? inputTokens + outputTokens,
              },
              total: {},
              modelContextWindow: 200_000,
            },
          },
        });
      }
      if (config.error) {
        this.send({
          method: "error",
          params: {
            threadId,
            turnId,
            willRetry: false,
            error: { message: config.error },
          },
        });
        return;
      }

      const response =
        config.response ?? JSON.stringify({ text: "ok", toolCalls: [] });
      for (const delta of config.deltas ?? [response]) {
        this.send({
          method: "item/agentMessage/delta",
          params: { threadId, turnId, itemId: `message_${this.turn}`, delta },
        });
      }
      this.send({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: {
            id: `message_${this.turn}`,
            type: "agentMessage",
            text: response,
          },
        },
      });
      this.send({
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: turnId, status: "completed", items: [] },
        },
      });
    });
  }

  private finish(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 0, null);
  }

  kill(): boolean {
    this.finish();
    return true;
  }
}

interface LaunchCapture {
  env?: NodeJS.ProcessEnv;
  args?: string[];
  children: FakeAppServerProcess[];
}

function installFakeServer(
  turns: readonly FakeTurn[],
  capture: LaunchCapture,
): void {
  __setCodexAppServerLauncherForTests((launch, env) => {
    capture.env = env;
    capture.args = launch.args;
    const child = new FakeAppServerProcess({ turns });
    capture.children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  });
}

function prompt() {
  return normalizePromptIR({
    system: "You edit files through host tools.",
    tools: [
      {
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    ],
    messages: [{ role: "user", content: "Create index.html" }],
  });
}

function agentPrompt(history: readonly ExtractedMessage[]) {
  return Fragment({
    children: [
      jsx("system", {
        children: "Use host tools to inspect and finish the task.",
      }),
      jsx("tool", { name: "list_files", description: "List project files" }),
      jsx("tool", {
        name: "done",
        description: "Finish the task",
        children: jsx("param", {
          name: "summary",
          type: "string",
          required: true,
        }),
      }),
      ...history.map((message) =>
        jsx("message", {
          role: message.role,
          toolCalls:
            message.role === "assistant" ? message.toolCalls : undefined,
          toolCallId: message.role === "tool" ? message.toolCallId : undefined,
          toolName: message.role === "tool" ? message.toolName : undefined,
          isError: message.role === "tool" ? message.isError : undefined,
          children: message.content,
        }),
      ),
    ],
  });
}

afterEach(() => {
  __setCodexAppServerLauncherForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.openai_api_key;
  delete process.env.JSX_AI_RUNTIME;
  delete process.env.JSX_AI_MODEL;
});

describe("Codex unified app-server runtime", () => {
  it("round-trips canonical tools, usage, auth environment, and structured output", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.OPENAI_API_KEY = "must-not-leak";
    process.env.CODEX_API_KEY = "must-not-leak-either";
    process.env.openai_api_key = "must-not-leak-on-windows";
    installFakeServer(
      [
        {
          response: JSON.stringify({
            text: "",
            toolCalls: [
              {
                name: "write_file",
                arguments_json: JSON.stringify({
                  path: "index.html",
                  content: "<canvas></canvas>",
                }),
              },
            ],
          }),
          usage: {
            inputTokens: 120,
            cachedInputTokens: 80,
            outputTokens: 25,
            reasoningOutputTokens: 7,
          },
        },
      ],
      capture,
    );

    const result = await callCodexRuntime(prompt(), "gpt-test", {
      codex: { codexPathOverride: "fake-codex" },
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("write_file");
    expect(result.toolCalls[0]?.args).toEqual({
      path: "index.html",
      content: "<canvas></canvas>",
    });
    expect(result.toolCalls[0]?.id).toContain("thread_1");
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 25,
      thinkingTokens: 7,
    });
    expect(result.request?.url).toBe("codex://app-server");
    expect(result.raw).toMatchObject({
      runtime: "codex",
      transport: "app-server",
    });
    expect(capture.args).toEqual(["app-server", "--stdio"]);
    expect(capture.env?.OPENAI_API_KEY).toBeUndefined();
    expect(capture.env?.CODEX_API_KEY).toBeUndefined();
    expect(capture.env?.openai_api_key).toBeUndefined();

    const requests = capture.children[0]?.requests ?? [];
    expect(
      requests.find((request) => request.method === "thread/start")?.params,
    ).toMatchObject({
      model: "gpt-test",
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
    });
    expect(
      requests.find((request) => request.method === "turn/start")?.params,
    ).toMatchObject({
      threadId: "thread_1",
      outputSchema: expect.any(Object),
    });
    expect(capture.children[0]?.exitCode).toBe(0);
  });

  it("can intentionally inherit API-key environment", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.OPENAI_API_KEY = "inherited";
    installFakeServer(
      [{ response: JSON.stringify({ text: "ok", toolCalls: [] }) }],
      capture,
    );
    const codex: CodexRuntimeOptions = {
      auth: "inherit",
      codexPathOverride: "fake-codex",
    };

    await callCodexRuntime(prompt(), undefined, { codex });
    expect(capture.env?.OPENAI_API_KEY).toBe("inherited");
  });

  it("rejects explicit apiKey so billing mode cannot change silently", async () => {
    await expect(
      callCodexRuntime(prompt(), undefined, {
        apiKey: "sk-explicit",
        codex: { codexPathOverride: "fake-codex" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("preserves timeout and caller-abort identities", async () => {
    const timeoutCapture: LaunchCapture = { children: [] };
    installFakeServer([{ block: true }], timeoutCapture);
    await expect(
      callCodexRuntime(prompt(), undefined, {
        timeoutMs: 1,
        codex: { codexPathOverride: "fake-codex" },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });

    const abortCapture: LaunchCapture = { children: [] };
    installFakeServer([{ block: true }], abortCapture);
    const controller = new AbortController();
    controller.abort("stop-now");
    await expect(
      callCodexRuntime(prompt(), undefined, {
        signal: controller.signal,
        codex: { codexPathOverride: "fake-codex" },
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("does not add an authentication hint to unrelated runtime errors", async () => {
    const capture: LaunchCapture = { children: [] };
    installFakeServer([{ error: "worker crashed" }], capture);

    try {
      await callCodexRuntime(prompt(), undefined, {
        codex: { codexPathOverride: "fake-codex" },
      });
      throw new Error("expected runtime failure");
    } catch (error) {
      expect(isJsxAiError(error, "RUNTIME_ERROR")).toBe(true);
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "worker crashed",
      );
      expect(
        error instanceof Error ? error.message : String(error),
      ).not.toContain("codex login");
    }
  });

  it("rejects undeclared tools returned by Codex", async () => {
    const capture: LaunchCapture = { children: [] };
    installFakeServer(
      [
        {
          response: JSON.stringify({
            text: "",
            toolCalls: [{ name: "shell", arguments_json: "{}" }],
          }),
        },
      ],
      capture,
    );

    await expect(
      callCodexRuntime(prompt(), undefined, {
        codex: { codexPathOverride: "fake-codex" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("routes callLLM through Codex from environment without requiring an API key or model", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.JSX_AI_RUNTIME = "codex";
    installFakeServer(
      [{ response: JSON.stringify({ text: "from env", toolCalls: [] }) }],
      capture,
    );

    const result = await callLLM(
      jsx("message", { role: "user", children: "Say hello" }),
      {
        codex: { codexPathOverride: "fake-codex" },
      },
    );

    expect(result.text).toBe("from env");
    expect(result.request?.url).toBe("codex://app-server");
    const threadStart = capture.children[0]?.requests.find(
      (request) => request.method === "thread/start",
    );
    expect(threadStart?.params).not.toMatchObject({
      model: expect.any(String),
    });
  });

  it("forwards progress, reuses one thread within runAgent, sends deltas, and closes the process", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.JSX_AI_RUNTIME = "codex";
    installFakeServer(
      [
        {
          response: JSON.stringify({
            text: "I will inspect the project.",
            toolCalls: [{ name: "list_files", arguments_json: "{}" }],
          }),
          progress: "Inspecting the project structure",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 40,
            outputTokens: 10,
            reasoningOutputTokens: 2,
          },
        },
        {
          response: JSON.stringify({
            text: "The project is ready.",
            toolCalls: [
              {
                name: "done",
                arguments_json: JSON.stringify({ summary: "complete" }),
              },
            ],
          }),
          usage: {
            inputTokens: 130,
            cachedInputTokens: 90,
            outputTokens: 12,
            reasoningOutputTokens: 1,
          },
        },
      ],
      capture,
    );
    const progress: string[] = [];

    const result = await runAgent({
      history: [{ role: "user", content: "Build it" }],
      buildPrompt: (history) => agentPrompt(history),
      callOptions: { codex: { codexPathOverride: "fake-codex" } },
      executeTool: (call) =>
        call.name === "list_files" ? '["index.html"]' : "done",
      isComplete: (response) =>
        response.toolCalls.some((call) => call.name === "done"),
      onEvent: (event) => {
        if (event.type === "runtime_progress")
          progress.push(`${event.progress.kind}:${event.progress.message}`);
      },
      maxSteps: 3,
    });

    expect(result.reason).toBe("completed");
    expect(capture.children).toHaveLength(1);
    const requests = capture.children[0]?.requests ?? [];
    expect(
      requests.filter((request) => request.method === "thread/start"),
    ).toHaveLength(1);
    const turns = requests.filter((request) => request.method === "turn/start");
    expect(turns).toHaveLength(2);
    const firstInput = JSON.stringify(turns[0]?.params);
    const secondInput = JSON.stringify(turns[1]?.params);
    expect(firstInput).toContain("applicationTools");
    expect(firstInput).toContain("Build it");
    expect(secondInput).toContain("index.html");
    expect(secondInput).not.toContain("applicationTools");
    expect(secondInput).not.toContain("Build it");
    expect(result.steps[0]?.response.request?.body.bridgeMode).toBe("initial");
    expect(result.steps[1]?.response.request?.body.bridgeMode).toBe("delta");
    expect(
      progress.some((message) =>
        message.includes("Inspecting the project structure"),
      ),
    ).toBe(true);
    expect(capture.children[0]?.exitCode).toBe(0);
  });

  it("streams only visible assistant text while structured tool JSON stays atomic", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.JSX_AI_RUNTIME = "codex";
    const response = JSON.stringify({
      text: "I’ll inspect the file, then update it.",
      toolCalls: [
        {
          name: "list_files",
          arguments_json: JSON.stringify({ secret: "must-not-stream" }),
        },
      ],
    });
    installFakeServer(
      [
        {
          response,
          deltas: [
            '{"text":"I\u2019ll inspect ',
            'the file, then update it.","toolCalls":[{"name":"list_',
            'files","arguments_json":"{\"secret\":\"must-not-stream\"}"}]}',
          ],
        },
      ],
      capture,
    );

    const deltas: string[] = [];
    const result = await runAgent({
      history: [{ role: "user", content: "Inspect" }],
      buildPrompt: (history) => agentPrompt(history),
      callOptions: { codex: { codexPathOverride: "fake-codex" } },
      executeTool: () => "listed",
      maxSteps: 1,
      onTextDelta: (event) => {
        deltas.push(event.delta);
      },
    });

    expect(deltas.join("")).toBe("I’ll inspect the file, then update it.");
    expect(deltas.join("")).not.toContain("list_files");
    expect(deltas.join("")).not.toContain("must-not-stream");
    expect(result.steps[0]?.response.toolCalls[0]?.name).toBe("list_files");
  });

  it("scopes native Codex process/thread reuse to one runAgent invocation", async () => {
    const capture: LaunchCapture = { children: [] };
    process.env.JSX_AI_RUNTIME = "codex";
    installFakeServer(
      [{ response: JSON.stringify({ text: "idle", toolCalls: [] }) }],
      capture,
    );

    const run = () =>
      runAgent({
        history: [{ role: "user", content: "Inspect" }],
        buildPrompt: (history) => agentPrompt(history),
        callOptions: { codex: { codexPathOverride: "fake-codex" } },
        executeTool: () => "unused",
        maxSteps: 1,
      });

    await run();
    await run();
    expect(capture.children).toHaveLength(2);
    expect(capture.children.every((child) => child.exitCode === 0)).toBe(true);
  });
});
