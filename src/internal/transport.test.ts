import { describe, expect, test } from "bun:test";
import { isJsxAiError } from "../errors";
import { parseSSEStream, requestJson, requestStream } from "./transport";
import { record, string } from "./json";

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("SSE transport parser", () => {
  test("parses data events and ignores DONE", async () => {
    const response = new Response(
      'data: {"text":"a"}\n\ndata: {"text":"b"}\n\ndata: [DONE]\n\n',
    );
    const chunks = await collect(
      parseSSEStream(response, (event) => string(record(event)?.text) ?? ""),
    );
    expect(chunks).toEqual(["a", "b"]);
  });

  test("supports multi-line SSE data fields", async () => {
    const response = new Response('data: {"text":\ndata: "joined"}\n\n');
    const chunks = await collect(
      parseSSEStream(response, (event) => string(record(event)?.text) ?? ""),
    );
    expect(chunks).toEqual(["joined"]);
  });

  test("parses a final event even when the stream omits the trailing blank line", async () => {
    const response = new Response('data: {"text":"last"}');
    const chunks = await collect(
      parseSSEStream(response, (event) => string(record(event)?.text) ?? ""),
    );
    expect(chunks).toEqual(["last"]);
  });

  test("does not silently swallow malformed JSON data events", async () => {
    const response = new Response("data: {bad-json}\n\n");
    let error: unknown;
    try {
      await collect(parseSSEStream(response, () => ""));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SyntaxError);
  });
});

describe("request policy", () => {
  test("rejects invalid retry and timeout configuration before fetching", async () => {
    let retryError: unknown;
    try {
      await requestJson("https://example.invalid", {}, { retries: -1 }, "test");
    } catch (caught) {
      retryError = caught;
    }
    expect(isJsxAiError(retryError, "INVALID_ARGUMENT")).toBe(true);

    let timeoutError: unknown;
    try {
      await requestJson(
        "https://example.invalid",
        {},
        { timeoutMs: 0 },
        "test",
      );
    } catch (caught) {
      timeoutError = caught;
    }
    expect(isJsxAiError(timeoutError, "INVALID_ARGUMENT")).toBe(true);
  });

  test("stream response remains linked to the external abort signal after headers", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestSignal = init?.signal ?? undefined;
      return new Response("data: [DONE]\n\n");
    }) as typeof fetch;

    try {
      await requestStream(
        "https://example.invalid",
        {},
        { signal: controller.signal },
        "test",
      );
      expect(requestSignal?.aborted).toBe(false);
      controller.abort(new Error("stop"));
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
