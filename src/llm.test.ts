import { afterEach, describe, expect, it } from "bun:test";
import { jsx } from "./jsx-runtime";
import { callLLM } from "./llm";

afterEach(() => {
  delete process.env.JSX_AI_RUNTIME;
  delete process.env.JSX_AI_MODEL;
});

describe("callLLM runtime configuration", () => {
  it("fails clearly when API runtime has no intentional model selection", async () => {
    await expect(
      callLLM(jsx("message", { role: "user", children: "hello" })),
    ).rejects.toThrow(
      'API runtime requires a model. Set JSX_AI_MODEL, <prompt model="...">, or callOptions.model.',
    );
  });
  it("fails clearly instead of dropping image attachments in API runtime", async () => {
    process.env.JSX_AI_RUNTIME = "api";
    process.env.JSX_AI_MODEL = "test-model";
    await expect(
      callLLM(
        jsx("message", {
          role: "user",
          attachments: [{ type: "image", path: "screenshot.png" }],
          children: "Inspect this screenshot",
        }),
      ),
    ).rejects.toThrow(
      /API runtime does not yet support canonical image attachments/,
    );
  });
});
