import { describe, expect, test } from "bun:test";
import type { AgentToolResult, CanonicalToolCall } from "../src/index";
import {
  BROWSER_GAME_TOOL_NAMES,
  createBrowserGameToolset,
  isBrowserGameActionToolName,
  type BrowserElementAction,
  type BrowserGameDriver,
} from "../examples/_browser-game-backend";

function call(
  name: string,
  args: Record<string, unknown> = {},
): CanonicalToolCall {
  return {
    id: `test_${name}`,
    name,
    args: args as CanonicalToolCall["args"],
  };
}

function fakeDriver(log: unknown[][]): BrowserGameDriver {
  const ok = (entry: unknown[]): Promise<AgentToolResult> => {
    log.push(entry);
    return Promise.resolve({ content: "ok" });
  };
  return {
    navigate: (url) => ok(["navigate", url]),
    snapshot: () => ok(["snapshot"]),
    action: (op: BrowserElementAction, id, value, delayMs) =>
      ok(["action", op, id, value, delayMs]),
    pointer: (x, y) => ok(["pointer", x, y]),
    key: (key, delayMs) => ok(["key", key, delayMs]),
    wait: (ms) => ok(["wait", ms]),
    back: () => ok(["back"]),
    screenshot: (label, fullPage) => ok(["screenshot", label, fullPage]),
    close: async () => {
      log.push(["close"]);
    },
  };
}

describe("browser game backend contract", () => {
  test("publishes one stable canonical tool list", () => {
    expect(BROWSER_GAME_TOOL_NAMES).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_action",
      "browser_pointer",
      "browser_key",
      "browser_wait",
      "browser_back",
      "browser_screenshot",
    ]);
    expect(new Set(BROWSER_GAME_TOOL_NAMES).size).toBe(
      BROWSER_GAME_TOOL_NAMES.length,
    );
  });

  test("routes and normalizes every canonical tool", async () => {
    const log: unknown[][] = [];
    const tools = createBrowserGameToolset(fakeDriver(log));

    await tools.executeTool(
      call("browser_navigate", { url: " https://example.com/game " }),
    );
    await tools.executeTool(call("browser_snapshot"));
    await tools.executeTool(
      call("browser_action", {
        op: "type",
        id: " e3 ",
        value: "hello",
        delayMs: 10_050.7,
      }),
    );
    await tools.executeTool(call("browser_pointer", { x: 12.5, y: 48 }));
    await tools.executeTool(
      call("browser_key", { key: " Enter ", delayMs: -20 }),
    );
    await tools.executeTool(call("browser_wait", { ms: 250.4 }));
    await tools.executeTool(call("browser_back"));
    await tools.executeTool(
      call("browser_screenshot", { label: " final ", fullPage: true }),
    );
    await tools.close();

    expect(log).toEqual([
      ["navigate", "https://example.com/game"],
      ["snapshot"],
      ["action", "type", "e3", "hello", 10_000],
      ["pointer", 12.5, 48],
      ["key", "Enter", 0],
      ["wait", 250],
      ["back"],
      ["screenshot", "final", true],
      ["close"],
    ]);
  });

  test("rejects malformed arguments before reaching a backend", async () => {
    const log: unknown[][] = [];
    const tools = createBrowserGameToolset(fakeDriver(log));

    const missingUrl = await tools.executeTool(call("browser_navigate"));
    const badPointer = await tools.executeTool(
      call("browser_pointer", { x: "12", y: 2 }),
    );
    const missingValue = await tools.executeTool(
      call("browser_action", { op: "fill", id: "e1" }),
    );
    const badAction = await tools.executeTool(
      call("browser_action", { op: "explode", id: "e1" }),
    );

    expect(missingUrl.isError).toBe(true);
    expect(badPointer.isError).toBe(true);
    expect(missingValue.isError).toBe(true);
    expect(badAction.isError).toBe(true);
    expect(log).toEqual([]);
  });

  test("classifies only state-changing browser tools as actions", () => {
    expect(isBrowserGameActionToolName("browser_action")).toBe(true);
    expect(isBrowserGameActionToolName("browser_pointer")).toBe(true);
    expect(isBrowserGameActionToolName("browser_key")).toBe(true);
    expect(isBrowserGameActionToolName("browser_back")).toBe(true);
    expect(isBrowserGameActionToolName("browser_snapshot")).toBe(false);
    expect(isBrowserGameActionToolName("browser_screenshot")).toBe(false);
    expect(isBrowserGameActionToolName("browser_wait")).toBe(false);
  });
});
