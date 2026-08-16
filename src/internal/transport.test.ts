import { describe, expect, test } from "bun:test";
import { parseSSEStream } from "./transport";
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
