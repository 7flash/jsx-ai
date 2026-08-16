import { describe, expect, test } from "bun:test";
import { array, record, string } from "../internal/json";
import type { PreparedPrompt } from "../types";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";
import { AnthropicProvider } from "./anthropic";

const prepared: PreparedPrompt = {
  system: "system",
  temperature: 0.42,
  maxTokens: 1234,
  messages: [
    { role: "user", content: "build it" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          name: "write_file",
          args: { path: "index.html", content: "<canvas>" },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      toolName: "write_file",
      content: "ok",
    },
    { role: "user", content: "improve it" },
    { role: "user", content: "and keep controls" },
  ],
};

describe("native history serialization", () => {
  test("OpenAI emits tool_calls and role:tool", () => {
    const body = new OpenAIProvider().buildRequest(
      prepared,
      "gpt-4.1",
      "key",
    ).body;
    const messages = array(body.messages).map(record);
    const toolCalls = array(messages[2]?.tool_calls).map(record);
    expect(string(toolCalls[0]?.id)).toBe("call-1");
    expect(messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: "ok",
    });
  });

  test("Gemini emits functionCall/functionResponse and merges user turns", () => {
    const body = new GeminiProvider().buildRequest(
      prepared,
      "gemini-2.5-flash",
      "key",
    ).body;
    const contents = array(body.contents).map(record).filter(Boolean);
    const parts = contents.flatMap((message) =>
      array(message?.parts).map(record).filter(Boolean),
    );
    expect(
      parts.some(
        (part) => string(record(part?.functionCall)?.name) === "write_file",
      ),
    ).toBe(true);
    expect(
      parts.some(
        (part) => string(record(part?.functionResponse)?.name) === "write_file",
      ),
    ).toBe(true);
    expect(array(contents.at(-1)?.parts).length).toBeGreaterThan(1);
  });

  test("Anthropic honors temperature, emits tool_use/tool_result, and alternates roles", () => {
    const body = new AnthropicProvider().buildRequest(
      prepared,
      "claude-sonnet-4-5",
      "key",
    ).body;
    const messages = array(body.messages).map(record).filter(Boolean);
    const blocks = messages.flatMap((message) =>
      array(message?.content).map(record).filter(Boolean),
    );
    expect(body.temperature).toBe(0.42);
    expect(blocks.some((block) => string(block?.type) === "tool_use")).toBe(
      true,
    );
    expect(blocks.some((block) => string(block?.type) === "tool_result")).toBe(
      true,
    );
    for (let index = 1; index < messages.length; index++) {
      expect(string(messages[index]?.role)).not.toBe(
        string(messages[index - 1]?.role),
      );
    }
  });

  test("OpenAI rejects malformed JSON tool arguments instead of silently using an empty object", () => {
    const provider = new OpenAIProvider();
    expect(() =>
      provider.parseResponse({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "bad-1",
                  type: "function",
                  function: { name: "write_file", arguments: "{not-json" },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow("invalid JSON");
  });
});
