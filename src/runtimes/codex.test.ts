import { afterEach, describe, expect, it } from "bun:test";
import { isJsxAiError } from "../errors";
import { normalizePromptIR } from "../ir";
import { callLLM } from "../llm";
import { jsx } from "../jsx-runtime";
import {
  __setCodexSdkLoaderForTests,
  callCodexRuntime,
  type CodexRuntimeOptions,
} from "./codex";

interface Capture {
  clientOptions?: Record<string, unknown>;
  threadOptions?: Record<string, unknown>;
  input?: string;
  runOptions?: Record<string, unknown>;
}

const capture: Capture = {};

function fakeSdk(finalResponse: string) {
  return {
    Codex: class {
      constructor(options?: Record<string, unknown>) {
        capture.clientOptions = options;
      }

      startThread(options?: Record<string, unknown>) {
        capture.threadOptions = options;
        return {
          id: "thread_test",
          async run(input: string, runOptions?: Record<string, unknown>) {
            capture.input = input;
            capture.runOptions = runOptions;
            return {
              finalResponse,
              items: [{ type: "agent_message", text: finalResponse }],
              usage: {
                input_tokens: 120,
                cached_input_tokens: 80,
                output_tokens: 25,
                reasoning_output_tokens: 7,
              },
            };
          },
        };
      }
    },
  };
}

function blockingSdk() {
  return {
    Codex: class {
      startThread() {
        return {
          id: "thread_blocked",
          async run(_input: string, runOptions?: { signal?: AbortSignal }) {
            const signal = runOptions?.signal;
            if (!signal) throw new Error("expected cancellation signal");
            if (signal.aborted) throw signal.reason;
            return new Promise<never>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
            });
          },
        };
      }
    },
  };
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

afterEach(() => {
  __setCodexSdkLoaderForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.openai_api_key;
  delete process.env.JSX_AI_RUNTIME;
  delete process.env.JSX_AI_MODEL;
  for (const key of Object.keys(capture)) delete capture[key as keyof Capture];
});

describe("Codex runtime", () => {
  it("round-trips canonical tools and maps Codex usage", async () => {
    process.env.OPENAI_API_KEY = "must-not-leak";
    process.env.CODEX_API_KEY = "must-not-leak-either";
    process.env.openai_api_key = "must-not-leak-on-windows";
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(
        JSON.stringify({
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
      ),
    );

    const result = await callCodexRuntime(prompt(), "gpt-5.3-codex");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("write_file");
    expect(result.toolCalls[0]?.args).toEqual({
      path: "index.html",
      content: "<canvas></canvas>",
    });
    expect(result.toolCalls[0]?.id).toContain("thread_test");
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 25,
      thinkingTokens: 7,
    });
    expect(result.request?.url).toBe("codex://local");

    const env = capture.clientOptions?.env as
      Record<string, string> | undefined;
    expect(env?.OPENAI_API_KEY).toBeUndefined();
    expect(env?.CODEX_API_KEY).toBeUndefined();
    expect(env?.openai_api_key).toBeUndefined();
    expect(capture.threadOptions).toMatchObject({
      model: "gpt-5.3-codex",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
    });
    expect(capture.input).toContain("applicationTools");
    expect(capture.input).toContain("write_file");
    expect(capture.runOptions?.outputSchema).toBeDefined();
  });

  it("can explicitly inherit API-key environment instead of forcing ChatGPT auth", async () => {
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "ok", toolCalls: [] })),
    );
    const codex: CodexRuntimeOptions = { auth: "inherit" };
    await callCodexRuntime(prompt(), "gpt-5.3-codex", { codex });
    expect(capture.clientOptions?.env).toBeUndefined();
  });

  it("rejects explicit apiKey in Codex runtime so billing mode cannot change silently", async () => {
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "ok", toolCalls: [] })),
    );

    await expect(
      callCodexRuntime(prompt(), "gpt-5.3-codex", { apiKey: "sk-explicit" }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("preserves Codex runtime timeout identity", async () => {
    __setCodexSdkLoaderForTests(async () => blockingSdk());

    await expect(
      callCodexRuntime(prompt(), "gpt-5.3-codex", { timeoutMs: 1 }),
    ).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
  });

  it("preserves caller cancellation identity", async () => {
    __setCodexSdkLoaderForTests(async () => blockingSdk());
    const controller = new AbortController();
    controller.abort("stop-now");

    await expect(
      callCodexRuntime(prompt(), "gpt-5.3-codex", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("rejects undeclared tools returned by the runtime", async () => {
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(
        JSON.stringify({
          text: "",
          toolCalls: [{ name: "shell", arguments_json: "{}" }],
        }),
      ),
    );

    await expect(
      callCodexRuntime(prompt(), "gpt-5.3-codex"),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("reports the optional SDK dependency clearly", async () => {
    __setCodexSdkLoaderForTests(async () => {
      throw new Error("module not found");
    });

    try {
      await callCodexRuntime(prompt(), "gpt-5.3-codex");
      throw new Error("expected callCodexRuntime to fail");
    } catch (error) {
      expect(isJsxAiError(error, "MISSING_RUNTIME_DEPENDENCY")).toBe(true);
    }
  });

  it("routes callLLM through Codex without resolving OPENAI_API_KEY", async () => {
    delete process.env.OPENAI_API_KEY;
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "hello", toolCalls: [] })),
    );

    const tree = jsx("message", { role: "user", children: "Say hello" });
    const result = await callLLM(tree, {
      runtime: "codex",
      provider: "openai",
      model: "gpt-5.3-codex",
    });

    expect(result.text).toBe("hello");
    expect(result.request?.url).toBe("codex://local");
  });

  it("lets Codex configuration choose the model when jsx-ai has no model override", async () => {
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "default model", toolCalls: [] })),
    );

    const tree = jsx("message", { role: "user", children: "Say hello" });
    await callLLM(tree, { runtime: "codex" });

    expect(capture.threadOptions?.model).toBeUndefined();
  });

  it("selects Codex from JSX_AI_RUNTIME without call options", async () => {
    process.env.JSX_AI_RUNTIME = "codex";
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "from env", toolCalls: [] })),
    );

    const tree = jsx("message", { role: "user", children: "Say hello" });
    const result = await callLLM(tree);

    expect(result.text).toBe("from env");
    expect(result.request?.url).toBe("codex://local");
    expect(capture.threadOptions?.model).toBeUndefined();
  });

  it("uses JSX_AI_MODEL as an optional Codex model override", async () => {
    process.env.JSX_AI_RUNTIME = "codex";
    process.env.JSX_AI_MODEL = "gpt-5.4";
    __setCodexSdkLoaderForTests(async () =>
      fakeSdk(JSON.stringify({ text: "from env", toolCalls: [] })),
    );

    const tree = jsx("message", { role: "user", children: "Say hello" });
    await callLLM(tree);

    expect(capture.threadOptions?.model).toBe("gpt-5.4");
  });
});
