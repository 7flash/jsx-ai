import { afterEach, describe, expect, it } from "bun:test";
import { resolveRuntimeConfig } from "./runtime-config";

afterEach(() => {
  delete process.env.JSX_AI_RUNTIME;
  delete process.env.JSX_AI_MODEL;
});

describe("runtime environment config", () => {
  it("defaults API calls to the API model", () => {
    expect(resolveRuntimeConfig()).toEqual({
      runtime: "api",
      model: "gemini-2.5-flash",
    });
  });

  it("lets Codex use its own configured model by default", () => {
    process.env.JSX_AI_RUNTIME = "codex";
    expect(resolveRuntimeConfig()).toEqual({ runtime: "codex" });
  });

  it("accepts a library-wide model override", () => {
    process.env.JSX_AI_RUNTIME = "codex";
    process.env.JSX_AI_MODEL = "gpt-5.4";
    expect(resolveRuntimeConfig()).toEqual({
      runtime: "codex",
      model: "gpt-5.4",
    });
  });

  it("gives explicit call options precedence over environment and JSX", () => {
    process.env.JSX_AI_RUNTIME = "codex";
    process.env.JSX_AI_MODEL = "gpt-5.4";
    expect(
      resolveRuntimeConfig(
        { runtime: "api", model: "gpt-explicit" },
        "claude-prompt",
      ),
    ).toEqual({
      runtime: "api",
      model: "gpt-explicit",
    });
  });

  it("lets JSX model beat the runtime default but not JSX_AI_MODEL", () => {
    expect(resolveRuntimeConfig({}, "claude-prompt")).toEqual({
      runtime: "api",
      model: "claude-prompt",
    });
    process.env.JSX_AI_MODEL = "gpt-env";
    expect(resolveRuntimeConfig({}, "claude-prompt")).toEqual({
      runtime: "api",
      model: "gpt-env",
    });
  });

  it("rejects invalid runtime environment values", () => {
    process.env.JSX_AI_RUNTIME = "magic";
    expect(() => resolveRuntimeConfig()).toThrow(
      'Invalid JSX_AI_RUNTIME="magic"',
    );
  });
});
