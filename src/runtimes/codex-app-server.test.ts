import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { streamLLM } from "../llm";
import { __setCodexAppServerLauncherForTests } from "./codex-app-server";

interface FakeServerOptions {
  emitDeltas?: boolean;
}

class FakeAppServerProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly requests: Array<{ id?: number; method?: string; params?: unknown }> =
    [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(private readonly options: FakeServerOptions = {}) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
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
      this.send({
        id: message.id,
        result: { thread: { id: "thread_stream" } },
      });
      return;
    }
    if (message.method === "turn/start" && typeof message.id === "number") {
      this.send({
        id: message.id,
        result: { turn: { id: "turn_stream", status: "inProgress" } },
      });
      queueMicrotask(() => {
        if (this.options.emitDeltas !== false) {
          this.send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread_stream",
              turnId: "turn_stream",
              itemId: "message_1",
              delta: "Hello",
            },
          });
          this.send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread_stream",
              turnId: "turn_stream",
              itemId: "message_1",
              delta: " from Codex",
            },
          });
        }
        this.send({
          method: "item/completed",
          params: {
            threadId: "thread_stream",
            turnId: "turn_stream",
            item: {
              id: "message_1",
              type: "agentMessage",
              text: "Hello from Codex",
            },
          },
        });
        this.send({
          method: "turn/completed",
          params: {
            threadId: "thread_stream",
            turn: { id: "turn_stream", status: "completed", items: [] },
          },
        });
      });
    }
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

afterEach(() => {
  __setCodexAppServerLauncherForTests();
  delete process.env.JSX_AI_RUNTIME;
  delete process.env.JSX_AI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
});

describe("Codex streamLLM app-server bridge", () => {
  it("streams assistant deltas with runtime/model resolved from Codex configuration", async () => {
    process.env.JSX_AI_RUNTIME = "codex";
    process.env.OPENAI_API_KEY = "must-not-leak";
    process.env.CODEX_API_KEY = "must-not-leak-either";
    let childEnv: NodeJS.ProcessEnv | undefined;
    let launchArgs: string[] | undefined;
    let child: FakeAppServerProcess | undefined;

    __setCodexAppServerLauncherForTests((launch, env) => {
      childEnv = env;
      launchArgs = launch.args;
      child = new FakeAppServerProcess();
      return child as unknown as ChildProcessWithoutNullStreams;
    });

    const chunks: string[] = [];
    for await (const chunk of streamLLM(
      [{ role: "user", content: "Say hello" }],
      {
        codex: {
          codexPathOverride: "fake-codex",
          modelReasoningEffort: "medium",
        },
      },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " from Codex"]);
    expect(chunks.join("")).toBe("Hello from Codex");
    expect(launchArgs).toEqual(["app-server", "--stdio"]);
    expect(childEnv?.OPENAI_API_KEY).toBeUndefined();
    expect(childEnv?.CODEX_API_KEY).toBeUndefined();

    const threadStart = child?.requests.find(
      (request) => request.method === "thread/start",
    );
    expect(threadStart?.params).toMatchObject({
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
    });
    const turnStart = child?.requests.find(
      (request) => request.method === "turn/start",
    );
    expect(turnStart?.params).toMatchObject({
      threadId: "thread_stream",
      effort: "medium",
    });
  });

  it("falls back to the completed agent message when no delta event is emitted", async () => {
    process.env.JSX_AI_RUNTIME = "codex";

    __setCodexAppServerLauncherForTests(
      () =>
        new FakeAppServerProcess({
          emitDeltas: false,
        }) as unknown as ChildProcessWithoutNullStreams,
    );

    const chunks: string[] = [];
    for await (const chunk of streamLLM(
      [{ role: "user", content: "Say hello" }],
      { codex: { codexPathOverride: "fake-codex" } },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello from Codex"]);
  });
});
