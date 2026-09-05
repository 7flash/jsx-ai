import type { AgentToolResult, CanonicalToolCall } from "../src/index";

export const BROWSER_GAME_TOOL_NAMES = [
  "browser_navigate",
  "browser_snapshot",
  "browser_action",
  "browser_pointer",
  "browser_key",
  "browser_wait",
  "browser_back",
  "browser_screenshot",
] as const;

export type BrowserGameToolName = (typeof BROWSER_GAME_TOOL_NAMES)[number];

export const BROWSER_GAME_ACTION_TOOL_NAMES = [
  "browser_action",
  "browser_pointer",
  "browser_key",
  "browser_back",
] as const satisfies readonly BrowserGameToolName[];

export type BrowserElementAction =
  "click" | "hover" | "fill" | "type" | "select";

export interface BrowserGameDriver {
  navigate(url: string): Promise<AgentToolResult>;
  snapshot(): Promise<AgentToolResult>;
  action(
    op: BrowserElementAction,
    id: string,
    value?: string,
    delayMs?: number,
  ): Promise<AgentToolResult>;
  pointer(x: number, y: number): Promise<AgentToolResult>;
  key(key: string, delayMs?: number): Promise<AgentToolResult>;
  wait(ms: number): Promise<AgentToolResult>;
  back(): Promise<AgentToolResult>;
  screenshot(label?: string, fullPage?: boolean): Promise<AgentToolResult>;
  close(): Promise<void>;
}

export interface BrowserGameToolset {
  readonly toolNames: readonly BrowserGameToolName[];
  executeTool(call: CanonicalToolCall): Promise<AgentToolResult>;
  close(): Promise<void>;
}

const TOOL_NAMES = new Set<string>(BROWSER_GAME_TOOL_NAMES);
const ACTION_TOOL_NAMES = new Set<string>(BROWSER_GAME_ACTION_TOOL_NAMES);
const ELEMENT_ACTIONS = new Set<BrowserElementAction>([
  "click",
  "hover",
  "fill",
  "type",
  "select",
]);

export function isBrowserGameToolName(
  value: string,
): value is BrowserGameToolName {
  return TOOL_NAMES.has(value);
}

export function isBrowserGameActionToolName(value: string): boolean {
  return ACTION_TOOL_NAMES.has(value);
}

function requiredString(call: CanonicalToolCall, name: string): string {
  const value = call.args[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${call.name} requires non-empty string argument ${name}`);
  }
  return value.trim();
}

function optionalString(
  call: CanonicalToolCall,
  name: string,
): string | undefined {
  const value = call.args[name];
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(call: CanonicalToolCall, name: string): number {
  const value = call.args[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${call.name} requires finite number argument ${name}`);
  }
  return value;
}

function boundedInteger(
  call: CanonicalToolCall,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = call.args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${call.name} argument ${name} must be a finite number`);
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function optionalBoolean(
  call: CanonicalToolCall,
  name: string,
  fallback: boolean,
): boolean {
  const value = call.args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`${call.name} argument ${name} must be boolean`);
  }
  return value;
}

function elementAction(call: CanonicalToolCall): BrowserElementAction {
  const value = requiredString(call, "op") as BrowserElementAction;
  if (!ELEMENT_ACTIONS.has(value)) {
    throw new Error(
      `browser_action has unsupported op ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Bind any browser implementation to the canonical browser_* tool contract.
 *
 * Argument validation, tool-name routing, bounds, and error normalization live here
 * so browser backends only implement browser primitives and cannot drift in their
 * interpretation of CanonicalToolCall.
 */
export function createBrowserGameToolset(
  driver: BrowserGameDriver,
): BrowserGameToolset {
  return {
    toolNames: BROWSER_GAME_TOOL_NAMES,
    async executeTool(call) {
      try {
        switch (call.name) {
          case "browser_navigate":
            return await driver.navigate(requiredString(call, "url"));
          case "browser_snapshot":
            return await driver.snapshot();
          case "browser_action": {
            const op = elementAction(call);
            const value = optionalString(call, "value");
            if (
              (op === "fill" || op === "type" || op === "select") &&
              value === undefined
            ) {
              throw new Error(`browser_action ${op} requires value`);
            }
            return await driver.action(
              op,
              requiredString(call, "id"),
              value,
              boundedInteger(call, "delayMs", 0, 0, 10_000),
            );
          }
          case "browser_pointer":
            return await driver.pointer(
              finiteNumber(call, "x"),
              finiteNumber(call, "y"),
            );
          case "browser_key":
            return await driver.key(
              requiredString(call, "key"),
              boundedInteger(call, "delayMs", 0, 0, 10_000),
            );
          case "browser_wait":
            return await driver.wait(
              boundedInteger(call, "ms", 250, 0, 10_000),
            );
          case "browser_back":
            return await driver.back();
          case "browser_screenshot":
            return await driver.screenshot(
              optionalString(call, "label")?.trim() || "screenshot",
              optionalBoolean(call, "fullPage", false),
            );
          default:
            return {
              content: `Unknown browser tool: ${call.name}`,
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    },
    close: () => driver.close(),
  };
}
