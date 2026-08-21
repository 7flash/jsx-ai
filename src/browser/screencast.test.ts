import { describe, expect, test } from "bun:test";
import {
  startLocalBrowserScreencast,
  type BrowserFrameSource,
} from "./screencast";

class FakeFrameSource implements BrowserFrameSource {
  captures = 0;

  async captureImage(): Promise<{
    bytes: Uint8Array;
    mimeType: "image/jpeg";
    url: string;
    title: string;
    capturedAt: number;
  }> {
    this.captures++;
    return {
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: "image/jpeg",
      url: "https://example.com/",
      title: "Example",
      capturedAt: 1_700_000_000_000 + this.captures,
    };
  }
}

describe("startLocalBrowserScreencast", () => {
  test("serves a loopback viewer and one-shot JPEG without credentials", async () => {
    const source = new FakeFrameSource();
    const cast = await startLocalBrowserScreencast(source, { port: 0, fps: 2 });

    try {
      expect(cast.url).toStartWith("http://127.0.0.1:");

      const viewer = await fetch(cast.url);
      expect(viewer.status).toBe(200);
      expect(await viewer.text()).toContain("Stagehand local screencast");

      const snapshot = await fetch(cast.snapshotUrl);
      expect(snapshot.headers.get("content-type")).toBe("image/jpeg");
      expect(Array.from(new Uint8Array(await snapshot.arrayBuffer()))).toEqual([
        0xff, 0xd8, 0xff, 0xd9,
      ]);

      const state = await fetch(new URL("state.json", cast.url));
      expect(await state.json()).toEqual({
        url: "https://example.com/",
        title: "Example",
        capturedAt: 1_700_000_000_001,
      });
    } finally {
      await cast.close();
    }
  });

  test("refuses non-loopback bindings because browser frames may contain secrets", async () => {
    const source = new FakeFrameSource();
    await expect(
      startLocalBrowserScreencast(source, { host: "0.0.0.0" }),
    ).rejects.toThrow("loopback");
  });
});
