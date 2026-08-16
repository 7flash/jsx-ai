import { describe, expect, test } from "bun:test";
import { array, record, string } from "../internal/json";
import { jsx, jsxs } from "../jsx-runtime";
import { extract } from "../render";
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

  test("Gemini 3 round-trips function-call IDs and thought signatures", () => {
    const provider = new GeminiProvider();
    const parsed = provider.parseResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "fc-1",
                  name: "write_file",
                  args: { path: "a.txt", content: "A" },
                },
                thoughtSignature: "signature-A",
              },
              {
                functionCall: {
                  id: "fc-2",
                  name: "write_file",
                  args: { path: "b.txt", content: "B" },
                },
              },
            ],
          },
        },
      ],
    });

    expect(parsed.nativeToolCalls[0]?.id).toBe("fc-1");
    expect(
      parsed.nativeToolCalls[0]?.providerMetadata?.gemini?.thoughtSignature,
    ).toBe("signature-A");
    expect(parsed.nativeToolCalls[1]?.id).toBe("fc-2");
    expect(parsed.nativeToolCalls[1]?.providerMetadata?.gemini).toBeUndefined();

    // Regression: agent examples render canonical history back through JSX on
    // every step. The JSX runtime must not strip opaque provider metadata.
    const jsxHistory = jsxs("prompt", {
      children: [
        jsx("message", { role: "user", children: "write both files" }),
        jsx("message", {
          role: "assistant",
          toolCalls: parsed.nativeToolCalls,
        }),
        jsx("message", {
          role: "tool",
          toolCallId: "fc-1",
          toolName: "write_file",
          children: "ok-a",
        }),
        jsx("message", {
          role: "tool",
          toolCallId: "fc-2",
          toolName: "write_file",
          children: "ok-b",
        }),
      ],
    });
    const jsxRoundTrip = extract(jsxHistory);
    const jsxCalls =
      jsxRoundTrip.messages[1]?.role === "assistant"
        ? jsxRoundTrip.messages[1].toolCalls
        : undefined;
    expect(jsxCalls?.[0]?.providerMetadata?.gemini?.thoughtSignature).toBe(
      "signature-A",
    );

    const roundTrip: PreparedPrompt = {
      messages: [
        { role: "user", content: "write both files" },
        { role: "assistant", content: "", toolCalls: jsxCalls ?? [] },
        {
          role: "tool",
          toolCallId: "fc-1",
          toolName: "write_file",
          content: "ok-a",
        },
        {
          role: "tool",
          toolCallId: "fc-2",
          toolName: "write_file",
          content: "ok-b",
        },
      ],
    };
    const body = provider.buildRequest(
      roundTrip,
      "gemini-3-flash-preview",
      "key",
    ).body;
    const contents = array(body.contents).map(record).filter(Boolean);
    const model = contents.find((content) => string(content?.role) === "model");
    const modelParts = array(model?.parts).map(record).filter(Boolean);
    expect(string(record(modelParts[0]?.functionCall)?.id)).toBe("fc-1");
    expect(string(modelParts[0]?.thoughtSignature)).toBe("signature-A");
    expect(string(record(modelParts[1]?.functionCall)?.id)).toBe("fc-2");
    expect(modelParts[1]?.thoughtSignature).toBeUndefined();

    const responseIds = contents
      .flatMap((content) => array(content?.parts).map(record).filter(Boolean))
      .map((part) => record(part?.functionResponse))
      .filter(Boolean)
      .map((response) => string(response?.id));
    expect(responseIds).toEqual(["fc-1", "fc-2"]);
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

describe("tool schema serialization", () => {
  const schemaPrepared: PreparedPrompt = {
    messages: [{ role: "user", content: "create it" }],
    nativeTools: [
      {
        name: "create_scene",
        description: "Create a scene",
        parameters: {
          type: "object",
          properties: {
            camera: {
              type: "object",
              properties: { fov: { type: "number", minimum: 1, maximum: 179 } },
              required: ["fov"],
              additionalProperties: false,
            },
          },
          required: ["camera"],
          additionalProperties: false,
        },
      },
    ],
  };

  test("all built-in native providers receive the same nested canonical schema", () => {
    const openai = new OpenAIProvider().buildRequest(
      schemaPrepared,
      "gpt-4.1",
      "key",
    ).body;
    const openaiFn = record(record(array(openai.tools)[0])?.function);
    expect(
      record(record(record(openaiFn?.parameters)?.properties)?.camera)?.type,
    ).toBe("object");

    const gemini = new GeminiProvider().buildRequest(
      schemaPrepared,
      "gemini-2.5-flash",
      "key",
    ).body;
    const declaration = record(
      array(record(array(gemini.tools)[0])?.functionDeclarations)[0],
    );
    expect(
      record(record(record(declaration?.parameters)?.properties)?.camera)?.type,
    ).toBe("object");

    const anthropic = new AnthropicProvider().buildRequest(
      schemaPrepared,
      "claude-sonnet-4-5",
      "key",
    ).body;
    const anthropicTool = record(array(anthropic.tools)[0]);
    expect(
      record(record(record(anthropicTool?.input_schema)?.properties)?.camera)
        ?.type,
    ).toBe("object");
  });
});
