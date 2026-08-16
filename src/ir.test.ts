import { describe, expect, test } from "bun:test";
import {
  normalizePreparedPrompt,
  normalizePromptIR,
  normalizeToolParametersSchema,
} from "./ir";
import { jsx } from "./jsx-runtime";
import { extract } from "./render";

describe("canonical prompt IR", () => {
  test("supports nested JSON Schema while keeping <param> shorthand", () => {
    const tree = jsx("prompt", {
      children: [
        jsx("tool", {
          name: "create_scene",
          description: "Create a scene",
          schema: {
            type: "object",
            properties: {
              camera: {
                type: "object",
                properties: {
                  fov: { type: "number", minimum: 1, maximum: 179 },
                },
                required: ["fov"],
                additionalProperties: false,
              },
              tags: { type: "array", items: { type: "string" }, minItems: 1 },
            },
            required: ["camera"],
            additionalProperties: false,
          },
        }),
        jsx("tool", {
          name: "write_file",
          description: "Write a file",
          children: jsx("param", {
            name: "path",
            required: true,
            schema: { type: "string", minLength: 1, pattern: "^[^/].*" },
            children: "Relative path",
          }),
        }),
        jsx("message", { role: "user", children: "Build the scene." }),
      ],
    });

    const prompt = extract(tree);
    expect(
      prompt.tools[0].parameters.properties.camera.properties?.fov.minimum,
    ).toBe(1);
    expect(prompt.tools[0].parameters.properties.tags.items?.type).toBe(
      "string",
    );
    expect(prompt.tools[1].parameters.properties.path.description).toBe(
      "Relative path",
    );
    expect(prompt.tools[1].parameters.properties.path.minLength).toBe(1);
  });

  test("clones and freezes schema inputs instead of retaining caller-owned mutable objects", () => {
    const raw = {
      type: "object" as const,
      properties: { value: { type: "string" as const, minLength: 1 } },
      required: ["value"],
    };
    const tool = jsx("tool", {
      name: "set_value",
      description: "Set it",
      schema: raw,
    });
    raw.properties.value.minLength = 99;

    const prompt = extract(
      jsx("prompt", {
        children: [tool, jsx("message", { role: "user", children: "set it" })],
      }),
    );

    expect(prompt.tools[0].parameters.properties.value.type).toBe("string");
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.tools)).toBe(true);
    expect(Object.isFrozen(prompt.tools[0].parameters)).toBe(true);
    expect(Object.isFrozen(prompt.tools[0].parameters.properties)).toBe(true);
    expect(
      Reflect.set(prompt.tools[0].parameters.properties, "other", {
        type: "string",
      }),
    ).toBe(false);
  });

  test("rejects schema typos and inconsistent required properties at the IR boundary", () => {
    expect(() =>
      normalizeToolParametersSchema({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["missing"],
      }),
    ).toThrow(/undeclared property/);

    expect(() =>
      normalizeToolParametersSchema({
        type: "object",
        properties: { path: { type: "string", minLenght: 1 } },
        required: ["path"],
      }),
    ).toThrow(/unsupported keyword/);
  });

  test("canonicalizes tool-call IDs and validates complete tool-result pairing", () => {
    const prompt = normalizePromptIR({
      tools: [],
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ name: "exec", args: { command: "ls" } }],
        },
        {
          role: "tool",
          content: "ok",
          toolCallId: "jsx_ir_0_0_exec",
          toolName: "exec",
        },
        { role: "user", content: "continue" },
      ],
    });
    expect(prompt.messages[0].role).toBe("assistant");
    if (prompt.messages[0].role !== "assistant")
      throw new Error("expected assistant");
    expect(prompt.messages[0].toolCalls?.[0].id).toBe("jsx_ir_0_0_exec");

    expect(() =>
      normalizePromptIR({
        tools: [],
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "x", name: "exec", args: {} }],
          },
          { role: "user", content: "skip the result" },
        ],
      }),
    ).toThrow(/resolve pending tool calls/);

    expect(() =>
      normalizePromptIR({
        tools: [],
        messages: [
          {
            role: "tool",
            content: "orphan",
            toolCallId: "x",
            toolName: "exec",
          },
        ],
      }),
    ).toThrow(/orphaned tool result/);
  });

  test("role-specific invalid fields cannot pass runtime normalization", () => {
    expect(() =>
      normalizePromptIR({
        tools: [],
        messages: [
          {
            role: "user",
            content: "hello",
            toolCalls: [{ id: "x", name: "exec", args: {} }],
          },
        ],
      }),
    ).toThrow(/user messages cannot contain/);

    expect(() =>
      normalizePromptIR({
        tools: [],
        messages: [
          { role: "tool", content: "ok", toolCallId: "", toolName: "exec" },
        ],
      }),
    ).toThrow(/toolCallId/);
  });

  test("custom strategy output is revalidated before providers see it", () => {
    expect(() => normalizePreparedPrompt({ messages: [] })).toThrow(
      /at least one message/,
    );
    expect(() =>
      normalizePreparedPrompt({
        messages: [
          { role: "tool", content: "bad", toolCallId: "x", toolName: "exec" },
        ],
      }),
    ).toThrow(/orphaned tool result/);
  });
});
