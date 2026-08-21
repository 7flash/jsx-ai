import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentToolResult } from "../agent";
import { Fragment, jsx } from "../jsx-runtime";
import type {
  CanonicalToolCall,
  JsxAiNode,
  JsonObject,
  JsonValue,
} from "../types";

type MaybePromise<T> = T | Promise<T>;
type UnknownRecord = Record<string, unknown>;

export interface BrowserSessionPageInfo {
  id: string;
  url: string;
  title: string;
  liveViewUrl: string;
  debuggerUrl: string;
}

export type BrowserEvent =
  | { type: "navigate"; url: string }
  | { type: "snapshot"; url: string; chars: number }
  | { type: "screenshot"; url: string; path: string; bytes: number }
  | { type: "action"; action: string; url: string }
  | { type: "session"; session: BrowserSessionInfo };

export interface StagehandBrowserToolOptions {
  /** Prefix for all tool names. Defaults to `browser`. */
  prefix?: string;
}

export interface StagehandBrowserControllerOptions {
  /** A Stagehand v4 browser handle from browserbase.launch/connect or a local browser launcher. */
  browser: unknown;
  /** Optional already-created Stagehand instance. If omitted, Stagehand.create({ browser }) is used. */
  stagehand?: unknown;
  /** Directory used for screenshot attachments that Codex can inspect. */
  artifactDir?: string;
  /** Exact origins the model is allowed to navigate to. Empty/omitted means any http(s) origin. */
  allowedOrigins?: readonly string[];
  /** Whether close() should close the provided browser handle. Defaults to false for injected handles. */
  ownsBrowser?: boolean;
  /** Browserbase API key used only for host-side live-view lookup. Never returned to the model. */
  browserbaseApiKey?: string;
  /** Browserbase API base URL. Defaults to https://api.browserbase.com. */
  browserbaseApiUrl?: string;
  /** Optional host-side event sink for UI/telemetry. */
  onEvent?: (event: BrowserEvent) => void | Promise<void>;
}

export interface LaunchLocalStagehandOptions {
  /** Options forwarded to Stagehand v4 localBrowser.launch(). */
  browserOptions?: JsonObject;
  artifactDir?: string;
  allowedOrigins?: readonly string[];
  onEvent?: StagehandBrowserControllerOptions["onEvent"];
}

/**
 * One-call local setup for the normal jsx-ai browser-agent path.
 * No Browserbase account or API key is involved.
 */
export interface CreateLocalStagehandBrowserToolsOptions extends LaunchLocalStagehandOptions {
  /** Optional tool-name customization passed to createStagehandBrowserTools(). */
  tools?: StagehandBrowserToolOptions;
}

export interface LaunchBrowserbaseStagehandOptions {
  apiKey?: string;
  apiUrl?: string;
  projectId?: string;
  region?: string;
  proxies?: boolean;
  keepAlive?: boolean;
  browserSettings?: JsonObject;
  artifactDir?: string;
  allowedOrigins?: readonly string[];
  onEvent?: StagehandBrowserControllerOptions["onEvent"];
}

export interface BrowserbaseLiveUrls {
  debuggerFullscreenUrl: string;
  debuggerUrl: string;
  wsUrl?: string;
  pages: readonly BrowserSessionPageInfo[];
}

export interface BrowserSessionInfo {
  sessionId?: string;
  dashboardUrl?: string;
  liveViewUrl?: string;
  debuggerUrl?: string;
  pages?: readonly BrowserSessionPageInfo[];
}

export interface BrowserSessionInfoOptions {
  /** Refresh Browserbase's live-view metadata instead of using the cached response. */
  refresh?: boolean;
}

export interface BrowserImageCaptureOptions {
  /** Image encoding. JPEG is useful for host-side live streams; PNG is used for Codex attachments. */
  type?: "png" | "jpeg";
  /** JPEG quality from 0-100. Ignored for PNG. Defaults to 72 for JPEG. */
  quality?: number;
  /** Capture the full scrollable page instead of only the current viewport. */
  fullPage?: boolean;
}

export interface BrowserImageFrame {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  url: string;
  title: string;
  capturedAt: number;
}

export interface StagehandBrowserToolset {
  Tools: () => JsxAiNode;
  executeTool: (call: CanonicalToolCall) => Promise<AgentToolResult>;
  /** Host-only Browserbase session/live-view metadata. This is never exposed as a model tool. */
  sessionInfo: (
    options?: BrowserSessionInfoOptions,
  ) => Promise<BrowserSessionInfo>;
  /** Refresh per-tab Browserbase live-view URLs, useful after popups/new tabs. */
  refreshSessionInfo: () => Promise<BrowserSessionInfo>;
  controller: StagehandBrowserController;
  close: () => Promise<void>;
}

interface LocatorLike {
  click?: () => Promise<unknown>;
  hover?: () => Promise<unknown>;
  fill?: (value: string) => Promise<unknown>;
  type?: (text: string, options?: { delay?: number }) => Promise<unknown>;
  selectOption?: (value: string | readonly string[]) => Promise<unknown>;
}

interface PageLike {
  pageId?: string;
  page_id?: string;
  goto?: (url: string, options?: UnknownRecord) => Promise<unknown>;
  url?: () => MaybePromise<string>;
  title?: () => MaybePromise<string>;
  locator?: (selector: string) => LocatorLike;
  snapshot?: (options?: UnknownRecord) => Promise<unknown>;
  screenshot?: (options?: UnknownRecord) => Promise<Uint8Array>;
  keyPress?: (key: string, options?: { delay?: number }) => Promise<unknown>;
  click?: (x: number, y: number, options?: UnknownRecord) => Promise<unknown>;
  evaluate?: (fn: unknown, arg?: unknown) => Promise<unknown>;
  goBack?: () => Promise<unknown>;
  go_back?: () => Promise<unknown>;
}

interface ContextLike {
  activePage?: () => MaybePromise<unknown>;
  active_page?: () => MaybePromise<unknown>;
  pages?: () => MaybePromise<unknown[]>;
  newPage?: () => Promise<unknown>;
  new_page?: () => Promise<unknown>;
}

interface BrowserLike {
  context?: ContextLike;
  close?: () => Promise<unknown>;
  sessionId?: string;
  session_id?: string;
  closed?: boolean;
}

interface StagehandLike {
  close?: () => Promise<unknown>;
}

interface SnapshotState {
  url: string;
  xpathById: Map<string, string>;
}

interface StagehandModuleLike {
  Stagehand: {
    create(options: { browser: unknown }): Promise<unknown>;
  };
  browserbase: {
    launch(options: UnknownRecord): Promise<unknown>;
  };
  localBrowser?: {
    launch(options?: UnknownRecord): Promise<unknown>;
  };
}

const TEXT_NODE_SUFFIX = /\/text\(\)(?:\[\d+\])?$/;
const DEFAULT_ARTIFACT_DIR = ".jsx-ai/browser";

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asBrowser(value: unknown): BrowserLike {
  const browser = record(value);
  if (!browser || !record(browser.context)) {
    throw new TypeError("Stagehand browser handle must expose browser.context");
  }
  return value as BrowserLike;
}

function asStagehand(value: unknown): StagehandLike {
  if (!record(value))
    throw new TypeError("Stagehand.create() returned an invalid instance");
  return value as StagehandLike;
}

function asPage(value: unknown): PageLike {
  if (!record(value))
    throw new TypeError("Stagehand browser returned an invalid page");
  return value as PageLike;
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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(
  call: CanonicalToolCall,
  name: string,
  fallback: boolean,
): boolean {
  const value = call.args[name];
  return typeof value === "boolean" ? value : fallback;
}

function optionalNumber(
  call: CanonicalToolCall,
  name: string,
  fallback: number,
): number {
  const value = call.args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeLabel(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "screenshot";
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.slice(0, 2000);
  }
}

function normalizePrefix(value: string | undefined): string {
  const prefix = value?.trim() || "browser";
  if (!/^[A-Za-z0-9_.-]+$/.test(prefix)) {
    throw new Error(
      "Browser tool prefix may contain only letters, numbers, _, -, and .",
    );
  }
  return prefix;
}

function toolName(prefix: string, suffix: string): string {
  return `${prefix}_${suffix}`;
}

function param(
  name: string,
  description: string,
  options: {
    type?: "string" | "number" | "integer" | "boolean";
    required?: boolean;
    enum?: readonly JsonValue[];
  } = {},
): JsxAiNode {
  return jsx("param", {
    name,
    ...(options.type ? { type: options.type } : {}),
    ...(options.required ? { required: true } : {}),
    ...(options.enum ? { enum: options.enum } : {}),
    children: description,
  });
}

function tool(
  name: string,
  description: string,
  children: readonly JsxAiNode[] = [],
): JsxAiNode {
  return jsx("tool", { name, description, children: [...children] });
}

/**
 * Pre-built Stagehand v4 browser tools for jsx-ai agents.
 *
 * These tools are intentionally deterministic. They never call Stagehand act/observe/extract/agent,
 * so Codex remains the sole reasoning/vision layer in a runAgent loop.
 */
export function StagehandBrowserTools(
  options: StagehandBrowserToolOptions = {},
): JsxAiNode {
  const prefix = normalizePrefix(options.prefix);
  return Fragment({
    children: [
      tool(toolName(prefix, "info"), "Read the current page URL and title."),
      tool(
        toolName(prefix, "navigate"),
        "Navigate the active browser page to an allowed http(s) URL.",
        [
          param("url", "Absolute http(s) URL to open", {
            type: "string",
            required: true,
          }),
        ],
      ),
      tool(
        toolName(prefix, "snapshot"),
        "Inspect the Stagehand accessibility/DOM snapshot. The returned element IDs are hydrated for browser_action calls.",
        [
          param("includeIframes", "Include iframe content when supported", {
            type: "boolean",
          }),
        ],
      ),
      tool(
        toolName(prefix, "action"),
        "Act on an element ID from the latest browser_snapshot. Re-snapshot after navigation or substantial DOM changes.",
        [
          param("op", "Interaction to perform", {
            type: "string",
            required: true,
            enum: ["click", "hover", "fill", "type", "select"],
          }),
          param("id", "Element ID from the latest browser_snapshot", {
            type: "string",
            required: true,
          }),
          param("value", "Text/value for fill, type, or select", {
            type: "string",
          }),
          param("delayMs", "Optional per-character delay for type", {
            type: "integer",
          }),
        ],
      ),
      tool(
        toolName(prefix, "pointer"),
        "Click viewport coordinates. Use this for canvas/vision-only controls that have no DOM element ID.",
        [
          param("x", "Viewport X coordinate in CSS pixels", {
            type: "number",
            required: true,
          }),
          param("y", "Viewport Y coordinate in CSS pixels", {
            type: "number",
            required: true,
          }),
        ],
      ),
      tool(
        toolName(prefix, "key"),
        "Press a keyboard key or key combination on the active page.",
        [
          param("key", "Key such as Enter, Tab, ArrowDown, Ctrl+A, or Escape", {
            type: "string",
            required: true,
          }),
          param("delayMs", "Optional key-down duration in milliseconds", {
            type: "integer",
          }),
        ],
      ),
      tool(
        toolName(prefix, "wait"),
        "Wait briefly for animation, navigation, or async UI state to settle.",
        [
          param("ms", "Wait duration in milliseconds (0-10000)", {
            type: "integer",
            required: true,
          }),
        ],
      ),
      tool(
        toolName(prefix, "back"),
        "Navigate the active page back in browser history.",
      ),
      tool(
        toolName(prefix, "screenshot"),
        "Capture the current browser viewport as a local image attachment. Codex must inspect the attached pixels before making visual claims.",
        [
          param("label", "Short filesystem-safe screenshot label", {
            type: "string",
          }),
          param(
            "fullPage",
            "Capture the full scrollable page instead of only the viewport",
            { type: "boolean" },
          ),
        ],
      ),
    ],
  });
}

async function loadStagehandV4(): Promise<StagehandModuleLike> {
  const specifier = "@browserbasehq/stagehand";
  const imported: unknown = await import(specifier);
  const root = record(imported);
  const stagehand = record(root?.Stagehand);
  const browserbase = record(root?.browserbase);
  if (
    typeof stagehand?.create !== "function" ||
    typeof browserbase?.launch !== "function"
  ) {
    throw new Error(
      "jsx-ai browser integration requires @browserbasehq/stagehand v4 (Stagehand.create + browserbase.launch)",
    );
  }
  return imported as StagehandModuleLike;
}

function sessionIdOf(browser: BrowserLike): string | undefined {
  return typeof browser.sessionId === "string"
    ? browser.sessionId
    : typeof browser.session_id === "string"
      ? browser.session_id
      : undefined;
}

function mapFromUnknown(value: unknown): Map<string, string> {
  if (value instanceof Map) {
    const out = new Map<string, string>();
    for (const [key, item] of value.entries()) {
      if (typeof key === "string" && typeof item === "string")
        out.set(key, item);
    }
    return out;
  }
  const source = record(value);
  const out = new Map<string, string>();
  if (!source) return out;
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string") out.set(key, item);
  }
  return out;
}

function normalizedSnapshot(value: unknown): {
  formattedTree: string;
  xpathById: Map<string, string>;
} {
  const root = record(value);
  const formattedTree =
    typeof root?.formattedTree === "string"
      ? root.formattedTree
      : typeof root?.formatted_tree === "string"
        ? root.formatted_tree
        : "";
  const xpathById = mapFromUnknown(root?.xpathMap ?? root?.xpath_map);
  if (!formattedTree) {
    throw new Error(
      "Stagehand snapshot did not return formattedTree/formatted_tree",
    );
  }
  return { formattedTree, xpathById };
}

export async function fetchBrowserbaseLiveUrls(
  apiKey: string,
  sessionId: string,
  apiUrl = "https://api.browserbase.com",
): Promise<BrowserbaseLiveUrls> {
  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/v1/sessions/${encodeURIComponent(sessionId)}/debug`,
    { headers: { "X-BB-API-Key": apiKey } },
  );
  if (!response.ok) {
    throw new Error(
      `Browserbase live-view lookup failed with HTTP ${response.status}`,
    );
  }
  const raw: unknown = await response.json();
  const data = record(raw);
  if (
    typeof data?.debuggerFullscreenUrl !== "string" ||
    typeof data?.debuggerUrl !== "string"
  ) {
    throw new Error("Browserbase live-view response is missing debugger URLs");
  }
  const pages = Array.isArray(data.pages)
    ? data.pages.flatMap((value) => {
        const page = record(value);
        if (
          typeof page?.id !== "string" ||
          typeof page?.url !== "string" ||
          typeof page?.title !== "string" ||
          typeof page?.debuggerFullscreenUrl !== "string" ||
          typeof page?.debuggerUrl !== "string"
        ) {
          return [];
        }
        return [
          {
            id: page.id,
            url: page.url,
            title: page.title,
            liveViewUrl: page.debuggerFullscreenUrl,
            debuggerUrl: page.debuggerUrl,
          } satisfies BrowserSessionPageInfo,
        ];
      })
    : [];
  return {
    debuggerFullscreenUrl: data.debuggerFullscreenUrl,
    debuggerUrl: data.debuggerUrl,
    ...(typeof data.wsUrl === "string" ? { wsUrl: data.wsUrl } : {}),
    pages,
  };
}

export class StagehandBrowserController {
  private readonly browser: BrowserLike;
  private readonly stagehand: StagehandLike;
  private readonly artifactDir: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly ownsBrowser: boolean;
  private readonly browserbaseApiKey?: string;
  private readonly browserbaseApiUrl: string;
  private readonly onEvent?: StagehandBrowserControllerOptions["onEvent"];
  private readonly snapshots = new WeakMap<object, SnapshotState>();
  private screenshotIndex = 0;
  private liveUrls?: BrowserbaseLiveUrls;

  constructor(
    options: StagehandBrowserControllerOptions & { stagehand: unknown },
  ) {
    this.browser = asBrowser(options.browser);
    this.stagehand = asStagehand(options.stagehand);
    this.artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
    mkdirSync(this.artifactDir, { recursive: true });
    this.allowedOrigins = new Set(
      (options.allowedOrigins ?? []).map((origin) => new URL(origin).origin),
    );
    this.ownsBrowser = options.ownsBrowser ?? false;
    this.browserbaseApiKey = options.browserbaseApiKey;
    this.browserbaseApiUrl =
      options.browserbaseApiUrl ?? "https://api.browserbase.com";
    this.onEvent = options.onEvent;
  }

  get sessionId(): string | undefined {
    return sessionIdOf(this.browser);
  }

  async sessionInfo(
    options: BrowserSessionInfoOptions = {},
  ): Promise<BrowserSessionInfo> {
    const sessionId = this.sessionId;
    if (!sessionId) return {};
    if ((options.refresh || !this.liveUrls) && this.browserbaseApiKey) {
      try {
        this.liveUrls = await fetchBrowserbaseLiveUrls(
          this.browserbaseApiKey,
          sessionId,
          this.browserbaseApiUrl,
        );
      } catch {
        // Live-view lookup is host observability only; browser control remains usable.
      }
    }
    const session: BrowserSessionInfo = {
      sessionId,
      dashboardUrl: `https://www.browserbase.com/sessions/${encodeURIComponent(sessionId)}`,
      ...(this.liveUrls
        ? {
            liveViewUrl: this.liveUrls.debuggerFullscreenUrl,
            debuggerUrl: this.liveUrls.debuggerUrl,
            pages: this.liveUrls.pages,
          }
        : {}),
    };
    await this.emit({ type: "session", session });
    return session;
  }

  /** Refresh Browserbase's per-tab live-view URLs for host-side screencast UIs. */
  refreshSessionInfo(): Promise<BrowserSessionInfo> {
    return this.sessionInfo({ refresh: true });
  }

  private async emit(event: BrowserEvent): Promise<void> {
    try {
      await this.onEvent?.(event);
    } catch {
      // Host-side observability must never turn an already-executed browser action into a retryable failure.
    }
  }

  private async activePage(): Promise<PageLike> {
    const context = this.browser.context;
    if (!context)
      throw new Error(
        "Stagehand browser handle does not expose browser.context",
      );

    if (typeof context.activePage === "function") {
      const active = await context.activePage();
      if (active) return asPage(active);
    }
    if (typeof context.active_page === "function") {
      const active = await context.active_page();
      if (active) return asPage(active);
    }

    if (typeof context.pages === "function") {
      const pages = await context.pages();
      const existing = pages[pages.length - 1];
      if (existing) return asPage(existing);
    }
    if (typeof context.newPage === "function")
      return asPage(await context.newPage());
    if (typeof context.new_page === "function")
      return asPage(await context.new_page());
    throw new Error(
      "Stagehand browser has no active page and cannot create one",
    );
  }

  private async pageUrl(page: PageLike): Promise<string> {
    if (typeof page.url !== "function") return "";
    return String(await page.url());
  }

  private async pageTitle(page: PageLike): Promise<string> {
    if (typeof page.title !== "function") return "";
    return String(await page.title());
  }

  private enforceNavigation(url: string): URL {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        "Browser navigation only permits http:// and https:// URLs",
      );
    }
    if (this.allowedOrigins.size && !this.allowedOrigins.has(parsed.origin)) {
      throw new Error(
        `Navigation to ${parsed.origin} is outside the configured allowedOrigins`,
      );
    }
    return parsed;
  }

  private async enforceCurrentOrigin(page: PageLike): Promise<void> {
    if (!this.allowedOrigins.size) return;
    const value = await this.pageUrl(page);
    if (!value) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (!this.allowedOrigins.has(parsed.origin)) {
      throw new Error(
        `Browser reached ${parsed.origin}, outside the configured allowedOrigins`,
      );
    }
  }

  private invalidateSnapshot(page: PageLike): void {
    if (typeof page === "object" && page !== null)
      this.snapshots.delete(page as object);
  }

  private async locatorFromSnapshot(
    page: PageLike,
    id: string,
  ): Promise<LocatorLike> {
    if (typeof page !== "object" || page === null)
      throw new Error("Invalid Stagehand page");
    const state = this.snapshots.get(page as object);
    if (!state)
      throw new Error(
        "No hydrated snapshot exists; call browser_snapshot first",
      );
    if (state.url !== (await this.pageUrl(page))) {
      this.snapshots.delete(page as object);
      throw new Error(
        "The page changed since the last snapshot; call browser_snapshot again",
      );
    }
    const xpath = state.xpathById.get(id);
    if (!xpath)
      throw new Error(
        `Snapshot element ID ${JSON.stringify(id)} is stale or unknown`,
      );
    if (typeof page.locator !== "function")
      throw new Error("Stagehand page does not expose locator()");
    return page.locator(`xpath=${xpath.replace(TEXT_NODE_SUFFIX, "")}`);
  }

  async info(): Promise<AgentToolResult> {
    const page = await this.activePage();
    return {
      content: [
        `URL: ${redactUrl(await this.pageUrl(page))}`,
        `Title: ${await this.pageTitle(page)}`,
        this.sessionId
          ? `Browserbase session: ${this.sessionId}`
          : "Browser session: local/injected",
      ].join("\n"),
    };
  }

  async navigate(url: string): Promise<AgentToolResult> {
    this.enforceNavigation(url);
    const page = await this.activePage();
    if (typeof page.goto !== "function")
      throw new Error("Stagehand page does not expose goto()");
    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
    await this.enforceCurrentOrigin(page);
    this.invalidateSnapshot(page);
    const current = redactUrl(await this.pageUrl(page));
    await this.emit({ type: "navigate", url: current });
    return {
      content: `Navigated to ${current}\nCall browser_snapshot for DOM state or browser_screenshot for visual state before acting.`,
    };
  }

  async snapshot(includeIframes = true): Promise<AgentToolResult> {
    const page = await this.activePage();
    if (typeof page.snapshot !== "function")
      throw new Error("Stagehand v4 page does not expose snapshot()");
    const raw = await page.snapshot({ includeIframes });
    const snapshot = normalizedSnapshot(raw);
    const url = await this.pageUrl(page);
    if (typeof page === "object" && page !== null) {
      this.snapshots.set(page as object, {
        url,
        xpathById: snapshot.xpathById,
      });
    }
    await this.emit({
      type: "snapshot",
      url: redactUrl(url),
      chars: snapshot.formattedTree.length,
    });
    return {
      content: [
        `URL: ${redactUrl(url)}`,
        `Title: ${await this.pageTitle(page)}`,
        `Hydrated element IDs: ${snapshot.xpathById.size}`,
        "",
        snapshot.formattedTree,
      ].join("\n"),
    };
  }

  async action(
    op: string,
    id: string,
    value?: string,
    delayMs = 0,
  ): Promise<AgentToolResult> {
    const page = await this.activePage();
    const locator = await this.locatorFromSnapshot(page, id);
    if (op === "click") {
      if (typeof locator.click !== "function")
        throw new Error("Stagehand locator does not expose click()");
      await locator.click();
    } else if (op === "hover") {
      if (typeof locator.hover !== "function")
        throw new Error("Stagehand locator does not expose hover()");
      await locator.hover();
    } else if (op === "fill") {
      if (value === undefined)
        throw new Error("browser_action fill requires value");
      if (typeof locator.fill !== "function")
        throw new Error("Stagehand locator does not expose fill()");
      await locator.fill(value);
    } else if (op === "type") {
      if (value === undefined)
        throw new Error("browser_action type requires value");
      if (typeof locator.type !== "function")
        throw new Error("Stagehand locator does not expose type()");
      await locator.type(value, {
        delay: Math.max(0, Math.min(1000, delayMs)),
      });
    } else if (op === "select") {
      if (value === undefined)
        throw new Error("browser_action select requires value");
      if (typeof locator.selectOption !== "function") {
        throw new Error("Stagehand locator does not expose selectOption()");
      }
      await locator.selectOption(value);
    } else {
      throw new Error(`Unsupported browser action ${JSON.stringify(op)}`);
    }
    await this.enforceCurrentOrigin(page);
    this.invalidateSnapshot(page);
    const url = redactUrl(await this.pageUrl(page));
    await this.emit({ type: "action", action: op, url });
    return {
      content: `${op} completed on snapshot element ${id}.\nCurrent URL: ${url}\nRe-snapshot if the DOM may have changed; use browser_screenshot when visual confirmation matters.`,
    };
  }

  async pointer(x: number, y: number): Promise<AgentToolResult> {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("browser_pointer requires finite x and y");
    const page = await this.activePage();
    if (typeof page.click !== "function")
      throw new Error("Stagehand page does not expose coordinate click()");
    await page.click(x, y);
    await this.enforceCurrentOrigin(page);
    this.invalidateSnapshot(page);
    const url = redactUrl(await this.pageUrl(page));
    await this.emit({ type: "action", action: "pointer", url });
    return {
      content: `Clicked viewport coordinate (${x}, ${y}).\nUse browser_screenshot to verify the visual result.`,
    };
  }

  async key(key: string, delayMs = 0): Promise<AgentToolResult> {
    const page = await this.activePage();
    if (typeof page.keyPress !== "function")
      throw new Error("Stagehand page does not expose keyPress()");
    await page.keyPress(key, { delay: Math.max(0, Math.min(10_000, delayMs)) });
    await this.enforceCurrentOrigin(page);
    this.invalidateSnapshot(page);
    const url = redactUrl(await this.pageUrl(page));
    await this.emit({ type: "action", action: `key:${key}`, url });
    return { content: `Pressed ${key}.\nCurrent URL: ${url}` };
  }

  async wait(ms: number): Promise<AgentToolResult> {
    const bounded = Math.max(0, Math.min(10_000, Math.round(ms)));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, bounded));
    const page = await this.activePage();
    await this.enforceCurrentOrigin(page);
    return {
      content: `Waited ${bounded}ms.\nCurrent URL: ${redactUrl(await this.pageUrl(page))}`,
    };
  }

  async back(): Promise<AgentToolResult> {
    const page = await this.activePage();
    if (typeof page.goBack === "function") await page.goBack();
    else if (typeof page.go_back === "function") await page.go_back();
    else
      throw new Error(
        "Stagehand page does not expose browser history back navigation",
      );
    await this.enforceCurrentOrigin(page);
    this.invalidateSnapshot(page);
    const url = redactUrl(await this.pageUrl(page));
    await this.emit({ type: "navigate", url });
    return { content: `Navigated back.\nCurrent URL: ${url}` };
  }

  /** Capture the active page as raw image bytes for host-side viewers or other integrations. */
  async captureImage(
    options: BrowserImageCaptureOptions = {},
  ): Promise<BrowserImageFrame> {
    const page = await this.activePage();
    if (typeof page.screenshot !== "function")
      throw new Error("Stagehand page does not expose screenshot()");

    const type = options.type ?? "png";
    const quality = Math.max(
      0,
      Math.min(100, Math.round(options.quality ?? 72)),
    );
    const bytes = await page.screenshot({
      type,
      fullPage: options.fullPage ?? false,
      animations: "disabled",
      ...(type === "jpeg" ? { quality } : {}),
    });
    const url = redactUrl(await this.pageUrl(page));
    return {
      bytes,
      mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
      url,
      title: await this.pageTitle(page),
      capturedAt: Date.now(),
    };
  }

  async screenshot(
    label = "screenshot",
    fullPage = false,
  ): Promise<AgentToolResult> {
    const frame = await this.captureImage({ type: "png", fullPage });
    const index = ++this.screenshotIndex;
    const filename = `${String(index).padStart(3, "0")}-${sanitizeLabel(label)}.png`;
    const path = resolve(this.artifactDir, filename);
    writeFileSync(path, Buffer.from(frame.bytes));
    await this.emit({
      type: "screenshot",
      url: frame.url,
      path,
      bytes: frame.bytes.byteLength,
    });
    return {
      content: [
        `Screenshot: ${filename}`,
        `URL: ${frame.url}`,
        `Title: ${frame.title}`,
        `PNG bytes: ${frame.bytes.byteLength}`,
        "Inspect the attached screenshot pixels before deciding the next browser action.",
      ].join("\n"),
      attachments: [
        {
          type: "image",
          path,
          mimeType: "image/png",
          alt: `Browser screenshot ${filename}`,
        },
      ],
    };
  }

  async executeTool(
    call: CanonicalToolCall,
    options: StagehandBrowserToolOptions = {},
  ): Promise<AgentToolResult> {
    const prefix = normalizePrefix(options.prefix);
    if (call.name === toolName(prefix, "info")) return this.info();
    if (call.name === toolName(prefix, "navigate"))
      return this.navigate(requiredString(call, "url"));
    if (call.name === toolName(prefix, "snapshot")) {
      return this.snapshot(optionalBoolean(call, "includeIframes", true));
    }
    if (call.name === toolName(prefix, "action")) {
      return this.action(
        requiredString(call, "op"),
        requiredString(call, "id"),
        optionalString(call, "value"),
        optionalNumber(call, "delayMs", 0),
      );
    }
    if (call.name === toolName(prefix, "pointer")) {
      return this.pointer(
        optionalNumber(call, "x", Number.NaN),
        optionalNumber(call, "y", Number.NaN),
      );
    }
    if (call.name === toolName(prefix, "key")) {
      return this.key(
        requiredString(call, "key"),
        optionalNumber(call, "delayMs", 0),
      );
    }
    if (call.name === toolName(prefix, "wait")) {
      return this.wait(optionalNumber(call, "ms", 0));
    }
    if (call.name === toolName(prefix, "back")) return this.back();
    if (call.name === toolName(prefix, "screenshot")) {
      return this.screenshot(
        optionalString(call, "label") ?? "screenshot",
        optionalBoolean(call, "fullPage", false),
      );
    }
    return {
      content: `Unknown Stagehand browser tool: ${call.name}`,
      isError: true,
    };
  }

  async close(): Promise<void> {
    try {
      await this.stagehand.close?.();
    } finally {
      if (this.ownsBrowser) await this.browser.close?.();
    }
  }
}

/** Attach jsx-ai's deterministic browser toolset to any Stagehand v4 browser handle. */
export async function attachStagehandBrowser(
  options: StagehandBrowserControllerOptions,
): Promise<StagehandBrowserController> {
  const stagehand =
    options.stagehand ??
    (await (
      await loadStagehandV4()
    ).Stagehand.create({ browser: options.browser }));
  return new StagehandBrowserController({ ...options, stagehand });
}

/** Launch a local Stagehand v4 browser and attach the same deterministic jsx-ai toolset. */
export async function launchLocalStagehand(
  options: LaunchLocalStagehandOptions = {},
): Promise<StagehandBrowserController> {
  const module = await loadStagehandV4();
  if (
    !module.localBrowser ||
    typeof module.localBrowser.launch !== "function"
  ) {
    throw new Error(
      "@browserbasehq/stagehand v4 does not expose localBrowser.launch()",
    );
  }
  const browser = await module.localBrowser.launch(
    (options.browserOptions ?? {}) as UnknownRecord,
  );
  try {
    const stagehand = await module.Stagehand.create({ browser });
    return new StagehandBrowserController({
      browser,
      stagehand,
      artifactDir: options.artifactDir,
      allowedOrigins: options.allowedOrigins,
      ownsBrowser: true,
      onEvent: options.onEvent,
    });
  } catch (error) {
    const handle = asBrowser(browser);
    if (typeof handle.close === "function") {
      try {
        await handle.close();
      } catch {
        // Preserve the Stagehand.create failure.
      }
    }
    throw error;
  }
}

/**
 * Launch a Browserbase cloud browser using Stagehand v4 and attach jsx-ai's deterministic tools.
 * Stagehand.create() is called without a model: Codex/runAgent remains the intelligence layer.
 */
export async function launchBrowserbaseStagehand(
  options: LaunchBrowserbaseStagehandOptions = {},
): Promise<StagehandBrowserController> {
  const apiKey =
    options.apiKey?.trim() || process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey)
    throw new Error("BROWSERBASE_API_KEY is required to launch Browserbase");

  const module = await loadStagehandV4();
  const allowedDomains = (options.allowedOrigins ?? []).map(
    (origin) => new URL(origin).hostname,
  );
  const userBrowserSettings = options.browserSettings ?? {};
  const userViewport = record(userBrowserSettings.viewport);
  const browserSettings: JsonObject = {
    ...userBrowserSettings,
    viewport: {
      width:
        typeof userViewport?.width === "number" ? userViewport.width : 1280,
      height:
        typeof userViewport?.height === "number" ? userViewport.height : 720,
    },
    recordSession:
      typeof userBrowserSettings.recordSession === "boolean"
        ? userBrowserSettings.recordSession
        : true,
    ...(allowedDomains.length
      ? { allowedDomains: [...new Set(allowedDomains)] }
      : {}),
  };

  const browser = await module.browserbase.launch({
    apiKey,
    ...(options.apiUrl ? { baseUrl: options.apiUrl } : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.region ? { region: options.region } : {}),
    ...(options.proxies !== undefined ? { proxies: options.proxies } : {}),
    ...(options.keepAlive !== undefined
      ? { keepAlive: options.keepAlive }
      : {}),
    browserSettings,
  });

  try {
    const stagehand = await module.Stagehand.create({ browser });
    return new StagehandBrowserController({
      browser,
      stagehand,
      artifactDir: options.artifactDir,
      allowedOrigins: options.allowedOrigins,
      ownsBrowser: true,
      browserbaseApiKey: apiKey,
      browserbaseApiUrl: options.apiUrl,
      onEvent: options.onEvent,
    });
  } catch (error) {
    await asBrowser(browser)
      .close?.()
      .catch(() => undefined);
    throw error;
  }
}

/** Bind a controller to a reusable JSX tool component and executeTool callback for runAgent(). */
export function createStagehandBrowserTools(
  controller: StagehandBrowserController,
  options: StagehandBrowserToolOptions = {},
): StagehandBrowserToolset {
  const prefix = normalizePrefix(options.prefix);
  return {
    Tools: () => StagehandBrowserTools({ prefix }),
    executeTool: (call) => controller.executeTool(call, { prefix }),
    sessionInfo: (sessionOptions) => controller.sessionInfo(sessionOptions),
    refreshSessionInfo: () => controller.refreshSessionInfo(),
    controller,
    close: () => controller.close(),
  };
}

/**
 * Launch local Chromium with Stagehand v4 and return ready-to-pass jsx-ai tools.
 * This is the recommended local/default integration: no Browserbase API key,
 * no Playwright sidecar, and no Stagehand reasoning model.
 */
export async function createLocalStagehandBrowserTools(
  options: CreateLocalStagehandBrowserToolsOptions = {},
): Promise<StagehandBrowserToolset> {
  const { tools = {}, ...launchOptions } = options;
  const controller = await launchLocalStagehand(launchOptions);
  return createStagehandBrowserTools(controller, tools);
}
