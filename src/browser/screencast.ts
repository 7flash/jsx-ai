import { createServer, type Server, type ServerResponse } from "node:http";
import type {
  BrowserImageFrame,
  StagehandBrowserController,
} from "./stagehand";

export interface LocalBrowserScreencastOptions {
  /** Loopback host to bind. Defaults to 127.0.0.1. Non-loopback binding is intentionally rejected. */
  host?: string;
  /** TCP port. Use 0 (default) to let the OS choose a free port. */
  port?: number;
  /** Frames per second. Bounded to 1-15. Defaults to 4. */
  fps?: number;
  /** JPEG quality from 20-95. Defaults to 72. */
  quality?: number;
}

export interface LocalBrowserScreencast {
  /** Local viewer page containing the live MJPEG stream. */
  url: string;
  /** Raw multipart MJPEG endpoint, useful for embedding in another local UI. */
  streamUrl: string;
  /** One-shot JPEG endpoint for host UIs that prefer polling. */
  snapshotUrl: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export interface BrowserFrameSource {
  captureImage(options: {
    type: "jpeg";
    quality: number;
    fullPage: false;
  }): Promise<BrowserImageFrame>;
}

const BOUNDARY = "jsx-ai-stagehand-frame";

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const normalized = Number.isFinite(value)
    ? Math.round(value as number)
    : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function assertLoopback(host: string): void {
  const normalized = host.trim().toLowerCase();
  if (
    normalized !== "localhost" &&
    normalized !== "127.0.0.1" &&
    normalized !== "::1" &&
    normalized !== "[::1]"
  ) {
    throw new Error(
      "Local Stagehand screencast may only bind to loopback (localhost, 127.0.0.1, or ::1)",
    );
  }
}

function viewerHtml(streamPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>jsx-ai local browser</title>
<style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  main{display:grid;gap:10px;padding:12px}
  header{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  #status{opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  img{display:block;max-width:100%;height:auto;border:1px solid #333;background:#000}
</style>
</head>
<body>
<main>
  <header><strong>jsx-ai · Stagehand local screencast</strong><span id="status">connecting…</span></header>
  <img src="${streamPath}" alt="Live local Chromium viewport">
</main>
<script>
  const status = document.getElementById('status');
  async function refresh(){
    try {
      const response = await fetch('/state.json', { cache: 'no-store' });
      const state = await response.json();
      status.textContent = state.url ? (state.title ? state.title + ' · ' : '') + state.url : 'waiting for first frame…';
    } catch { status.textContent = 'stream active'; }
  }
  refresh(); setInterval(refresh, 1000);
</script>
</body>
</html>`;
}

function writeFrame(response: ServerResponse, frame: BrowserImageFrame): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(
    `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.bytes.byteLength}\r\nX-Captured-At: ${frame.capturedAt}\r\n\r\n`,
  );
  response.write(frame.bytes);
  response.write("\r\n");
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new Error("Local screencast server did not expose a TCP address"),
        );
        return;
      }
      resolvePromise(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Start a credential-free local viewer for the active Stagehand page.
 *
 * The stream is host observability only: frames are not added to the agent history.
 * Codex should still use browser_screenshot when it needs pixels for reasoning.
 */
export async function startLocalBrowserScreencast(
  source: StagehandBrowserController | BrowserFrameSource,
  options: LocalBrowserScreencastOptions = {},
): Promise<LocalBrowserScreencast> {
  const host = options.host?.trim() || "127.0.0.1";
  assertLoopback(host);
  const port = boundedInteger(options.port, 0, 0, 65_535);
  const fps = boundedInteger(options.fps, 4, 1, 15);
  const quality = boundedInteger(options.quality, 72, 20, 95);
  const intervalMs = Math.max(1, Math.round(1000 / fps));

  const clients = new Set<ServerResponse>();
  let latest: BrowserImageFrame | undefined;
  let capturing = false;
  let closed = false;

  const capture = async (): Promise<BrowserImageFrame> => {
    const frame = await source.captureImage({
      type: "jpeg",
      quality,
      fullPage: false,
    });
    latest = frame;
    return frame;
  };

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;

    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method Not Allowed");
      return;
    }

    if (pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(viewerHtml("/stream.mjpg"));
      return;
    }

    if (pathname === "/state.json") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify(
          latest
            ? {
                url: latest.url,
                title: latest.title,
                capturedAt: latest.capturedAt,
              }
            : {},
        ),
      );
      return;
    }

    if (pathname === "/snapshot.jpg") {
      try {
        const frame = await capture();
        response.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": String(frame.bytes.byteLength),
          "Cache-Control": "no-store",
        });
        response.end(frame.bytes);
      } catch (error) {
        response.writeHead(503, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(
          error instanceof Error ? error.message : "Screenshot unavailable",
        );
      }
      return;
    }

    if (pathname === "/stream.mjpg") {
      response.writeHead(200, {
        "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Connection: "keep-alive",
        Pragma: "no-cache",
      });
      clients.add(response);
      if (latest) writeFrame(response, latest);
      const remove = () => clients.delete(response);
      request.once("close", remove);
      response.once("close", remove);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  });

  const actualPort = await listen(server, port, host);

  const timer = setInterval(() => {
    if (closed || capturing || clients.size === 0) return;
    capturing = true;
    void capture()
      .then((frame) => {
        for (const client of clients) writeFrame(client, frame);
      })
      .catch(() => {
        // A page may be navigating/closing between frames. The next tick retries.
      })
      .finally(() => {
        capturing = false;
      });
  }, intervalMs);
  const timerHandle = timer as typeof timer & { unref?: () => void };
  timerHandle.unref?.();

  const displayHost = host === "::1" || host === "[::1]" ? "[::1]" : host;
  const baseUrl = `http://${displayHost}:${actualPort}`;

  return {
    url: `${baseUrl}/`,
    streamUrl: `${baseUrl}/stream.mjpg`,
    snapshotUrl: `${baseUrl}/snapshot.jpg`,
    host,
    port: actualPort,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    },
  };
}
