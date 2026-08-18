import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Stagehand } from "@browserbasehq/stagehand";

const MAX_DIAGNOSTICS = 40;
const MAX_ARIA_CHARS = 12_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

interface InjectedDiagnostics {
  pageErrors: string[];
  failedRequests: Array<{ url: string; error: string }>;
}

export interface StagehandSnapshot {
  path: string;
  filename: string;
  bytes: number;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  ariaSnapshot: string;
  diagnostics: {
    console: Array<{ type: string; text: string }>;
    pageErrors: string[];
    failedRequests: Array<{ url: string; error: string }>;
  };
}

export interface StagehandGameSession {
  sessionId: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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

function normalizeLabel(value: string): string {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text.slice(0, 80) || "snapshot";
}

function trimDiagnostics<T>(items: T[]): void {
  if (items.length > MAX_DIAGNOSTICS) {
    items.splice(0, items.length - MAX_DIAGNOSTICS);
  }
}

/**
 * Bun-native local browser adapter for the visual game-QA example.
 * Stagehand is used only as a deterministic CDP browser SDK; jsx-ai/Codex remains
 * the sole reasoning agent and Stagehand's act/extract/observe/agent APIs are unused.
 */
export class StagehandGameBrowser {
  private stagehand?: Stagehand;
  private artifactDir?: string;
  private openedUrl?: string;
  private allowedOrigin?: string;
  private screenshotIndex = 0;
  private readonly consoleMessages: Array<{ type: string; text: string }> = [];

  async open(url: string, artifactDir: string): Promise<StagehandGameSession> {
    await this.close();

    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("game_open URL must use http:// or https://");
    }

    this.artifactDir = resolve(artifactDir);
    mkdirSync(this.artifactDir, { recursive: true });
    this.screenshotIndex = 0;
    this.consoleMessages.length = 0;

    const executablePath = process.env.STAGEHAND_CHROME_PATH?.trim();
    const headlessValue = process.env.STAGEHAND_HEADLESS?.trim().toLowerCase();
    const headless = !["0", "false", "no"].includes(headlessValue || "");

    const stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      localBrowserLaunchOptions: {
        headless,
        viewport: DEFAULT_VIEWPORT,
        ...(executablePath ? { executablePath } : {}),
      },
    });
    await stagehand.init();
    this.stagehand = stagehand;

    const page =
      stagehand.context.pages()[0] ?? (await stagehand.context.newPage());

    // Stagehand's public Page API exposes console events but not Playwright-style
    // pageerror/requestfailed events. Capture page/runtime failures at document start
    // without introducing Playwright or a Node sidecar.
    await page.addInitScript(() => {
      const root = globalThis as typeof globalThis & {
        __jsxAiGameDiagnostics?: InjectedDiagnostics;
      };
      if (root.__jsxAiGameDiagnostics) return;

      const diagnostics: InjectedDiagnostics = {
        pageErrors: [],
        failedRequests: [],
      };
      root.__jsxAiGameDiagnostics = diagnostics;

      const keepBounded = <T>(items: T[]) => {
        if (items.length > 40) items.splice(0, items.length - 40);
      };
      const errorText = (value: unknown): string => {
        if (value instanceof Error) return value.stack || value.message;
        return String(value ?? "unknown error");
      };

      globalThis.addEventListener(
        "error",
        (event) => {
          const target = event.target as
            (EventTarget & { src?: string; href?: string }) | null;
          const resourceUrl = target?.src || target?.href;
          if (resourceUrl) {
            diagnostics.failedRequests.push({
              url: String(resourceUrl),
              error: "resource load failed",
            });
            keepBounded(diagnostics.failedRequests);
            return;
          }
          diagnostics.pageErrors.push(
            errorText(event.error || event.message || "page error"),
          );
          keepBounded(diagnostics.pageErrors);
        },
        true,
      );

      globalThis.addEventListener("unhandledrejection", (event) => {
        diagnostics.pageErrors.push(errorText(event.reason));
        keepBounded(diagnostics.pageErrors);
      });
    });

    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      this.consoleMessages.push({
        type,
        text: message.text().slice(0, 2000),
      });
      trimDiagnostics(this.consoleMessages);
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
    await sleep(500);
    this.openedUrl = page.url();
    this.allowedOrigin = new URL(this.openedUrl).origin;

    return {
      sessionId: stagehand.sessionId || "local",
      url: redactUrl(page.url()),
      title: await page.title(),
      viewport: await this.viewport(),
    };
  }

  async press(key: string, holdMs = 0): Promise<void> {
    const page = this.page();
    await page.keyPress(key, { delay: Math.max(0, Math.min(10_000, holdMs)) });
    await this.enforceGameOrigin();
  }

  async click(x: number, y: number): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("game_click requires finite x and y coordinates");
    }
    await this.page().click(x, y);
    await sleep(100);
    await this.enforceGameOrigin();
  }

  async wait(ms: number): Promise<void> {
    await sleep(Math.max(0, Math.min(10_000, Math.round(ms))));
    await this.enforceGameOrigin();
  }

  async snapshot(label: string): Promise<StagehandSnapshot> {
    const page = this.page();
    if (!this.artifactDir) {
      throw new Error("Browser artifact directory was not initialized");
    }

    const safeLabel = normalizeLabel(label || "snapshot");
    const index = ++this.screenshotIndex;
    const filename = `${String(index).padStart(2, "0")}-${safeLabel}.png`;
    const path = resolve(this.artifactDir, filename);
    const bytes = await page.screenshot({
      type: "png",
      animations: "disabled",
    });
    writeFileSync(path, bytes);

    let ariaSnapshot = "";
    try {
      ariaSnapshot = (await page.snapshot()).formattedTree.slice(
        0,
        MAX_ARIA_CHARS,
      );
    } catch {
      // Canvas-heavy games may expose little/no useful accessibility structure.
    }

    let injected: InjectedDiagnostics = { pageErrors: [], failedRequests: [] };
    try {
      injected = await page.evaluate(() => {
        const diagnostics = (
          globalThis as typeof globalThis & {
            __jsxAiGameDiagnostics?: InjectedDiagnostics;
          }
        ).__jsxAiGameDiagnostics;
        return diagnostics
          ? {
              pageErrors: [...diagnostics.pageErrors],
              failedRequests: [...diagnostics.failedRequests],
            }
          : { pageErrors: [], failedRequests: [] };
      });
    } catch {
      // Diagnostics are supplemental; screenshot capture remains authoritative.
    }

    return {
      path,
      filename,
      bytes: bytes.length,
      url: redactUrl(page.url()),
      title: await page.title(),
      viewport: await this.viewport(),
      ariaSnapshot,
      diagnostics: {
        console: [...this.consoleMessages],
        pageErrors: injected.pageErrors.slice(-MAX_DIAGNOSTICS),
        failedRequests: injected.failedRequests
          .slice(-MAX_DIAGNOSTICS)
          .map((request) => ({
            url: redactUrl(request.url),
            error: request.error.slice(0, 2000),
          })),
      },
    };
  }

  async close(): Promise<void> {
    const stagehand = this.stagehand;
    this.stagehand = undefined;
    this.artifactDir = undefined;
    this.openedUrl = undefined;
    this.allowedOrigin = undefined;
    if (!stagehand) return;
    try {
      await stagehand.close();
    } catch {
      // Cleanup is best effort; preserve the original agent result/error.
    }
  }

  private page() {
    const page = this.stagehand?.context.activePage();
    if (!page) throw new Error("Browser is not open. Call game_open first.");
    return page;
  }

  private async viewport(): Promise<{
    width: number;
    height: number;
    devicePixelRatio: number;
  }> {
    return this.page().evaluate(() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      devicePixelRatio: globalThis.devicePixelRatio,
    }));
  }

  private async enforceGameOrigin(): Promise<void> {
    if (!this.allowedOrigin) return;
    const page = this.page();
    const current = page.url();
    let currentOrigin = "";
    try {
      currentOrigin = new URL(current).origin;
    } catch {
      // Invalid/non-HTTP page URLs are treated as origin violations.
    }
    if (currentOrigin === this.allowedOrigin) return;

    if (this.openedUrl) {
      try {
        await page.goto(this.openedUrl, {
          waitUntil: "domcontentloaded",
          timeoutMs: 30_000,
        });
        await sleep(250);
      } catch {
        // Preserve the navigation violation as the primary error.
      }
    }
    throw new Error(
      `Game action navigated outside the configured origin (${this.allowedOrigin}) to ${current}; navigation was rejected.`,
    );
  }
}
