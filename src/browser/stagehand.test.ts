import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { StagehandBrowserController } from "./stagehand";
import type { CanonicalToolCall, JsonObject } from "../types";

function call(name: string, args: JsonObject = {}): CanonicalToolCall {
  return { id: `test-${name}`, name, args };
}

class FakeLocator {
  readonly calls: string[] = [];

  async click(): Promise<void> {
    this.calls.push("click");
  }

  async hover(): Promise<void> {
    this.calls.push("hover");
  }

  async fill(value: string): Promise<void> {
    this.calls.push(`fill:${value}`);
  }

  async type(text: string, options?: { delay?: number }): Promise<void> {
    this.calls.push(`type:${text}:${options?.delay ?? 0}`);
  }

  async selectOption(value: string | readonly string[]): Promise<void> {
    this.calls.push(`select:${Array.isArray(value) ? value.join(",") : value}`);
  }
}

class FakePage {
  currentUrl = "https://example.com/";
  currentTitle = "Example";
  readonly locators = new Map<string, FakeLocator>();
  readonly pointerClicks: Array<[number, number]> = [];
  readonly keys: string[] = [];

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.currentTitle = "Navigated";
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return this.currentTitle;
  }

  async snapshot(): Promise<unknown> {
    return {
      formattedTree: "- button: Continue [id=btn-1]",
      xpathMap: { "btn-1": "/html/body/button[1]" },
    };
  }

  locator(selector: string): FakeLocator {
    const existing = this.locators.get(selector);
    if (existing) return existing;
    const locator = new FakeLocator();
    this.locators.set(selector, locator);
    return locator;
  }

  async screenshot(): Promise<Uint8Array> {
    return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }

  async click(x: number, y: number): Promise<void> {
    this.pointerClicks.push([x, y]);
  }

  async keyPress(key: string): Promise<void> {
    this.keys.push(key);
  }

  async goBack(): Promise<void> {
    this.currentUrl = "https://example.com/back";
  }
}

class FakeBrowser {
  closed = false;
  sessionId = "session-test";

  constructor(readonly page: FakePage) {}

  readonly context = {
    pages: async (): Promise<unknown[]> => [this.page],
  };

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeStagehand {
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("StagehandBrowserController", () => {
  test("hydrates Stagehand snapshot IDs and executes deterministic locator actions", async () => {
    const page = new FakePage();
    const browser = new FakeBrowser(page);
    const stagehand = new FakeStagehand();
    const controller = new StagehandBrowserController({ browser, stagehand });

    const snapshot = await controller.executeTool(call("browser_snapshot"));
    expect(snapshot.content).toContain("Hydrated element IDs: 1");
    expect(snapshot.content).toContain("Continue");

    await controller.executeTool(
      call("browser_action", { op: "click", id: "btn-1" }),
    );
    const locator = page.locators.get("xpath=/html/body/button[1]");
    expect(locator?.calls).toEqual(["click"]);
  });

  test("invalidates snapshot IDs after a mutating action", async () => {
    const page = new FakePage();
    const controller = new StagehandBrowserController({
      browser: new FakeBrowser(page),
      stagehand: new FakeStagehand(),
    });

    await controller.executeTool(call("browser_snapshot"));
    await controller.executeTool(
      call("browser_action", { op: "click", id: "btn-1" }),
    );
    await expect(
      controller.executeTool(
        call("browser_action", { op: "click", id: "btn-1" }),
      ),
    ).rejects.toThrow("browser_snapshot");
  });

  test("enforces configured navigation origins", async () => {
    const page = new FakePage();
    const controller = new StagehandBrowserController({
      browser: new FakeBrowser(page),
      stagehand: new FakeStagehand(),
      allowedOrigins: ["https://example.com"],
    });

    await controller.executeTool(
      call("browser_navigate", { url: "https://example.com/docs" }),
    );
    await expect(
      controller.executeTool(
        call("browser_navigate", { url: "https://attacker.example/" }),
      ),
    ).rejects.toThrow("allowedOrigins");
  });

  test("supports visual coordinate clicks and screenshot image attachments", async () => {
    const artifactDir = resolve(".tmp-stagehand-browser-test");
    rmSync(artifactDir, { recursive: true, force: true });
    const page = new FakePage();
    const controller = new StagehandBrowserController({
      browser: new FakeBrowser(page),
      stagehand: new FakeStagehand(),
      artifactDir,
    });

    await controller.executeTool(call("browser_pointer", { x: 120, y: 80 }));
    expect(page.pointerClicks).toEqual([[120, 80]]);

    const result = await controller.executeTool(
      call("browser_screenshot", { label: "after click" }),
    );
    const path = result.attachments?.[0]?.path;
    expect(path).toBeTruthy();
    expect(path && existsSync(path)).toBe(true);
    expect(result.attachments?.[0]?.mimeType).toBe("image/png");

    rmSync(artifactDir, { recursive: true, force: true });
  });

  test("closes Stagehand first and only closes injected browser when ownership is enabled", async () => {
    const page = new FakePage();
    const browser = new FakeBrowser(page);
    const stagehand = new FakeStagehand();
    const borrowed = new StagehandBrowserController({ browser, stagehand });
    await borrowed.close();
    expect(stagehand.closed).toBe(true);
    expect(browser.closed).toBe(false);

    const ownedBrowser = new FakeBrowser(page);
    const ownedStagehand = new FakeStagehand();
    const owned = new StagehandBrowserController({
      browser: ownedBrowser,
      stagehand: ownedStagehand,
      ownsBrowser: true,
    });
    await owned.close();
    expect(ownedStagehand.closed).toBe(true);
    expect(ownedBrowser.closed).toBe(true);
  });
});
