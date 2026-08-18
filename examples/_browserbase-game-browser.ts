import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { JsonObject } from "../src/index";

interface BrowserRequest {
  id: number;
  method: string;
  params?: JsonObject;
}

interface BrowserResponse {
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

export interface BrowserbaseSnapshot {
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

export interface BrowserbaseGameSession {
  sessionId: string;
  debuggerUrl?: string;
  recordingUrl: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

/**
 * Bun-facing client for the Node Browserbase/Playwright sidecar.
 * The Browserbase API key is injected only into the sidecar environment.
 */
export class BrowserbaseGameBrowser {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor(apiKey: string) {
    const workerPath = fileURLToPath(
      new URL("./browserbase-game-worker.mjs", import.meta.url),
    );
    this.child = spawn("node", [workerPath], {
      cwd: process.cwd(),
      env: { ...process.env, BROWSERBASE_API_KEY: apiKey },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stderr.pipe(process.stderr);
    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => this.handleLine(line));
    this.child.once("error", (error) =>
      this.failAll(
        new Error(`Browser sidecar failed to start: ${error.message}`),
      ),
    );
    this.child.once("exit", (code, signal) => {
      if (!this.closed) {
        this.failAll(
          new Error(
            `Browser sidecar exited unexpectedly (${signal || code || "unknown"})`,
          ),
        );
      }
    });
  }

  private handleLine(line: string): void {
    let response: BrowserResponse;
    try {
      response = JSON.parse(line) as BrowserResponse;
    } catch {
      this.failAll(
        new Error(
          `Browser sidecar emitted invalid JSON: ${line.slice(0, 500)}`,
        ),
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
        new Error(response.error || "Browserbase sidecar request failed"),
      );
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request<T>(
    method: string,
    params?: JsonObject,
    timeoutMs = 90_000,
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Browserbase sidecar is closed"));
    const id = this.nextId++;
    const request: BrowserRequest = {
      id,
      method,
      ...(params ? { params } : {}),
    };
    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Browserbase sidecar ${method} timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
        timer,
      });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  open(url: string, artifactDir: string): Promise<BrowserbaseGameSession> {
    return this.request("open", { url, artifactDir, timeoutSeconds: 1800 });
  }

  press(key: string, holdMs = 0): Promise<void> {
    return this.request("press", { key, holdMs });
  }

  click(x: number, y: number): Promise<void> {
    return this.request("click", { x, y });
  }

  wait(ms: number): Promise<void> {
    return this.request("wait", { ms });
  }

  snapshot(label: string): Promise<BrowserbaseSnapshot> {
    return this.request("snapshot", { label });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.closed = false;
      await this.request("close", undefined, 10_000);
    } catch {
      // Cleanup is best effort; preserve the original agent result/error.
    } finally {
      this.closed = true;
      this.child.stdin.end();
    }
  }
}
