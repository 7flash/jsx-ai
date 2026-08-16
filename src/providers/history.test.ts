import { describe, expect, test } from "bun:test";
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
    expect(body.messages[2].tool_calls[0].id).toBe("call-1");
    expect(body.messages[3]).toEqual({
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
    expect(
      body.contents.some((m: any) =>
        m.parts.some((p: any) => p.functionCall?.name === "write_file"),
      ),
    ).toBe(true);
    expect(
      body.contents.some((m: any) =>
        m.parts.some((p: any) => p.functionResponse?.name === "write_file"),
      ),
    ).toBe(true);
    expect(
      body.contents[body.contents.length - 1].parts.length,
    ).toBeGreaterThan(1);
  });

  test("Anthropic honors temperature, emits tool_use/tool_result, and alternates roles", () => {
    const body = new AnthropicProvider().buildRequest(
      prepared,
      "claude-sonnet-4-5",
      "key",
    ).body;
    expect(body.temperature).toBe(0.42);
    expect(
      body.messages.some((m: any) =>
        m.content.some((b: any) => b.type === "tool_use"),
      ),
    ).toBe(true);
    expect(
      body.messages.some((m: any) =>
        m.content.some((b: any) => b.type === "tool_result"),
      ),
    ).toBe(true);
    for (let i = 1; i < body.messages.length; i++)
      expect(body.messages[i].role).not.toBe(body.messages[i - 1].role);
  });
});
