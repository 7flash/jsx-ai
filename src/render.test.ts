import { describe, expect, test } from "bun:test";
import { extract } from "./render";
import { jsx } from "./jsx-runtime";

describe("prompt IR", () => {
  test("preserves provider override and structured tool history", () => {
    const tree = jsx("prompt", {
      provider: "anthropic",
      children: [
        jsx("message", {
          role: "assistant",
          toolCalls: [{ id: "x", name: "exec", args: { command: "ls" } }],
          children: "",
        }),
        jsx("message", {
          role: "tool",
          toolCallId: "x",
          toolName: "exec",
          children: "ok",
        }),
      ],
    });
    const prompt = extract(tree);
    expect(prompt.providerOverride).toBe("anthropic");
    expect(prompt.messages[0].toolCalls?.[0].name).toBe("exec");
    expect(prompt.messages[1].toolCallId).toBe("x");
  });

  test("unknown JSX tags fail loudly", () => {
    expect(() => jsx("tol", { name: "exec" })).toThrow(/Unknown JSX tag/);
  });
});
