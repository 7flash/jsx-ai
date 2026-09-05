import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, JsonObject } from "../src/index";
import type {
  BrowserElementAction,
  BrowserGameDriver,
} from "./_browser-game-backend";

interface WorkerRequest {
  id: number;
  method: string;
  params?: JsonObject;
}

interface WorkerResponse {
  id: number | null;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ObscuraSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  text: string;
  elements: Array<{
    id: string;
    tag: string;
    role?: string;
    type?: string;
    text?: string;
    label?: string;
    value?: string;
    href?: string;
    disabled: boolean;
  }>;
  diagnostics: {
    console: Array<{ type: string; text: string }>;
    pageErrors: string[];
    failedRequests: Array<{ url: string; error: string }>;
  };
}

export interface ObscuraScreenshot {
  path: string;
  filename: string;
  bytes: number;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  fullPage: boolean;
}

export interface ObscuraSessionInfo {
  endpoint: string;
  managed: boolean;
  pid?: number;
  url?: string;
  title?: string;
}

export type ObscuraBrowserEvent =
  | { type: "navigation"; url: string }
  | { type: "action"; action: string; target?: string }
  | { type: "screenshot"; path: string; fullPage: boolean };

export interface ObscuraGameBrowserOptions {
  artifactDir: string;
  allowedOrigin: string;
  onEvent?: (event: ObscuraBrowserEvent) => void;
}

/**
 * Bun-facing JSONL client for the Node/Puppeteer Obscura worker.
 *
 * The worker owns the optional local `obscura serve` process because Puppeteer is
 * officially documented as a CDP client for Obscura and keeping it in Node avoids
 * coupling the jsx-ai example runtime to Puppeteer's host-runtime compatibility.
 */
export class ObscuraGameBrowser implements BrowserGameDriver {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: ObscuraGameBrowserOptions) {
    const workerPath = fileURLToPath(
      new URL("./obscura-game-worker.mjs", import.meta.url),
    );
    this.child = spawn("node", [workerPath], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stderr.pipe(process.stderr);
    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line: string) => this.handleLine(line));
    this.child.once("error", (error: Error) => {
      this.failAll(
        new Error(`Obscura worker failed to start: ${error.message}`),
      );
    });
    this.child.once("exit", (code: number | null, signal: string | null) => {
      if (!this.closed) {
        this.failAll(
          new Error(
            `Obscura worker exited unexpectedly (${signal || code || "unknown"})`,
          ),
        );
      }
    });
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.failAll(
        new Error(`Obscura worker emitted invalid JSON: ${line.slice(0, 500)}`),
      );
      return;
    }

    if (typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.ok) pending.resolve(response.result);
    else
      pending.reject(
        new Error(response.error || "Obscura worker request failed"),
      );
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private request<T>(
    method: string,
    params?: JsonObject,
    timeoutMs = 90_000,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Obscura browser is closed"));
    }

    const id = this.nextId++;
    const request: WorkerRequest = {
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Obscura ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
        timer,
      });
      this.child.stdin.write(
        `${JSON.stringify(request)}\n`,
        (error: Error | null | undefined) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (pending) clearTimeout(pending.timer);
          this.pending.delete(id);
          reject(error);
        },
      );
    });
  }

  async navigate(url: string): Promise<AgentToolResult> {
    const parsed = new URL(url);
    if (parsed.origin !== this.options.allowedOrigin) {
      return {
        content: `Navigation rejected: ${parsed.origin} is outside configured origin ${this.options.allowedOrigin}`,
        isError: true,
      };
    }
    const result = await this.request<ObscuraSessionInfo>(
      "navigate",
      {
        url,
        artifactDir: this.options.artifactDir,
        allowedOrigin: this.options.allowedOrigin,
      },
      120_000,
    );
    this.options.onEvent?.({ type: "navigation", url: result.url ?? url });
    return {
      content: `Opened ${result.url ?? url}${result.title ? ` — ${result.title}` : ""}`,
    };
  }

  async snapshot(): Promise<AgentToolResult> {
    const snapshot = await this.request<ObscuraSnapshot>("snapshot");
    return {
      content: JSON.stringify(
        {
          url: snapshot.url,
          title: snapshot.title,
          viewport: snapshot.viewport,
          text: snapshot.text,
          elements: snapshot.elements,
          diagnostics: snapshot.diagnostics,
        },
        null,
        2,
      ),
    };
  }

  async action(
    op: BrowserElementAction,
    id: string,
    value?: string,
    delayMs = 0,
  ): Promise<AgentToolResult> {
    const result = await this.request<{ url: string; title: string }>(
      "action",
      {
        op,
        id,
        ...(value !== undefined ? { value } : {}),
        delayMs,
      },
    );
    this.options.onEvent?.({ type: "action", action: op, target: id });
    return {
      content: `${op} completed on snapshot element ${id}.\nCurrent URL: ${result.url}\nRe-snapshot if the DOM may have changed; use browser_screenshot when visual confirmation matters.`,
    };
  }

  async pointer(x: number, y: number): Promise<AgentToolResult> {
    const result = await this.request<{ url: string; title: string }>(
      "pointer",
      {
        x,
        y,
      },
    );
    this.options.onEvent?.({
      type: "action",
      action: "pointer",
      target: `${x},${y}`,
    });
    return {
      content: `Clicked viewport coordinate (${x}, ${y}).\nCurrent URL: ${result.url}\nUse browser_screenshot to verify the visual result.`,
    };
  }

  async key(key: string, delayMs = 0): Promise<AgentToolResult> {
    const result = await this.request<{ url: string; title: string }>("key", {
      key,
      holdMs: delayMs,
    });
    this.options.onEvent?.({ type: "action", action: "key", target: key });
    return {
      content: `Pressed ${key}${delayMs ? ` for ${delayMs}ms` : ""}.\nCurrent URL: ${result.url}`,
    };
  }

  async wait(ms: number): Promise<AgentToolResult> {
    await this.request("wait", { ms });
    return { content: `Waited ${ms}ms` };
  }

  async back(): Promise<AgentToolResult> {
    const result = await this.request<{ url: string; title: string }>("back");
    this.options.onEvent?.({ type: "action", action: "back" });
    return { content: `Navigated back.\nCurrent URL: ${result.url}` };
  }

  async screenshot(
    label = "screenshot",
    fullPage = false,
  ): Promise<AgentToolResult> {
    const shot = await this.request<ObscuraScreenshot>(
      "screenshot",
      { label, fullPage },
      120_000,
    );
    this.options.onEvent?.({
      type: "screenshot",
      path: shot.path,
      fullPage,
    });
    return {
      content: [
        `Screenshot: ${shot.filename}`,
        `URL: ${shot.url}`,
        `Title: ${shot.title}`,
        `Viewport: ${shot.viewport.width}x${shot.viewport.height} @ ${shot.viewport.devicePixelRatio}x`,
        `PNG bytes: ${shot.bytes}`,
        shot.fullPage ? "Capture: full page" : "Capture: current viewport",
        "Inspect the attached screenshot pixels before deciding the next browser action.",
      ].join("\n"),
      attachments: [
        {
          type: "image",
          path: shot.path,
          mimeType: "image/png",
          alt: `Obscura browser screenshot: ${shot.filename}`,
        },
      ],
    };
  }

  sessionInfo(): Promise<ObscuraSessionInfo> {
    return this.request("sessionInfo");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request("close", undefined, 15_000);
    } catch {
      // Cleanup is best effort; preserve the original agent/model error.
    } finally {
      this.closed = true;
      this.failAll(new Error("Obscura browser closed"));
      this.child.stdin.end();
    }
  }
}
