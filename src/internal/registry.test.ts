import { describe, expect, test } from "bun:test";
import { isJsxAiError } from "../errors";
import type { Provider } from "../providers/provider";
import type { RenderStrategy } from "../types";
import {
  listProviders,
  listStrategies,
  registerProvider,
  registerStrategy,
  resolveProvider,
  resolveStrategy,
} from "./registry";

function provider(name: string): Provider {
  return {
    name,
    buildRequest: () => ({
      url: "https://example.invalid",
      headers: {},
      body: {},
    }),
    parseResponse: (data) => ({ text: "", nativeToolCalls: [], raw: data }),
  };
}

function strategy(name: string): RenderStrategy {
  return {
    name,
    prepare: (prompt) => ({ messages: prompt.messages }),
    parseResponse: (response) => ({
      text: response.text,
      toolCalls: response.nativeToolCalls,
    }),
  };
}

describe("registry lifecycle", () => {
  test("registers by object name and disposer removes the registration", () => {
    const dispose = registerProvider(provider("test-provider"));
    expect(listProviders()).toContain("test-provider");
    expect(resolveProvider("ignored", "test-provider").name).toBe(
      "test-provider",
    );
    dispose();
    expect(listProviders()).not.toContain("test-provider");
  });

  test("nested registrations restore the previous value", () => {
    const first = provider("replaceable");
    const second = provider("replaceable");
    const disposeFirst = registerProvider(first);
    const disposeSecond = registerProvider(second);
    expect(resolveProvider("ignored", "replaceable")).toBe(second);
    disposeSecond();
    expect(resolveProvider("ignored", "replaceable")).toBe(first);
    disposeFirst();
  });

  test("registration aliases cannot disagree with object names", () => {
    let error: unknown;
    try {
      registerProvider("alias", provider("actual"));
    } catch (caught) {
      error = caught;
    }
    expect(isJsxAiError(error, "INVALID_ARGUMENT")).toBe(true);
  });

  test("strategies have the same disposable lifecycle and auto remains reserved", () => {
    const dispose = registerStrategy(strategy("test-strategy"));
    expect(listStrategies()).toContain("test-strategy");
    expect(
      resolveStrategy({ tools: [], messages: [] }, "test-strategy").name,
    ).toBe("test-strategy");
    dispose();
    expect(listStrategies()).not.toContain("test-strategy");

    let error: unknown;
    try {
      registerStrategy(strategy("auto"));
    } catch (caught) {
      error = caught;
    }
    expect(isJsxAiError(error, "INVALID_ARGUMENT")).toBe(true);
  });
});
