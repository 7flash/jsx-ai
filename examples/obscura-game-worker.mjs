#!/usr/bin/env node
/**
 * Node/Puppeteer CDP worker for examples/obscura-game-agent.tsx.
 *
 * It either connects to OBSCURA_WS_ENDPOINT or launches `obscura serve` locally.
 * stdout is reserved for the JSONL protocol; diagnostics are written to stderr.
 */

import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { createServer, isIP } from "node:net";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import puppeteer from "puppeteer-core";

const MAX_DIAGNOSTICS = 40;
const MAX_TEXT_CHARS = 12_000;
const MAX_ELEMENTS = 180;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const REF_ATTRIBUTE = "data-jsx-ai-obscura-ref";

let obscuraProcess;
let managedObscura = false;
let browser;
let page;
let artifactDir;
let allowedOrigin;
let openedUrl;
let endpoint;
let screenshotIndex = 0;
let obscuraStartError;
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function boundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function trimDiagnostics(items) {
  if (items.length > MAX_DIAGNOSTICS) items.splice(0, items.length - MAX_DIAGNOSTICS);
}

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).slice(0, 2000);
  }
}

function normalizeLabel(value) {
  const text = String(value || "screenshot")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text.slice(0, 80) || "screenshot";
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function privateTarget(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const family = isIP(host);
  if (family === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (family === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
}

function attachDiagnostics(target) {
  target.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    consoleMessages.push({ type, text: message.text().slice(0, 2000) });
    trimDiagnostics(consoleMessages);
  });
  target.on("pageerror", (error) => {
    pageErrors.push(String(error?.stack || error?.message || error).slice(0, 4000));
    trimDiagnostics(pageErrors);
  });
  target.on("requestfailed", (request) => {
    failedRequests.push({
      url: redactUrl(request.url()),
      error: request.failure()?.errorText || "request failed",
    });
    trimDiagnostics(failedRequests);
  });
}

function diagnostics() {
  return {
    console: [...consoleMessages],
    pageErrors: [...pageErrors],
    failedRequests: [...failedRequests],
  };
}

async function launchObscura(targetUrl) {
  const configured = String(process.env.OBSCURA_WS_ENDPOINT || "").trim();
  if (configured) {
    endpoint = configured;
    managedObscura = false;
    return;
  }

  const target = new URL(targetUrl);
  const port = boundedInteger(process.env.OBSCURA_PORT, await freePort(), 1024, 65535);
  const binary = String(process.env.OBSCURA_BIN || "obscura").trim() || "obscura";
  const args = ["serve", "--host", "127.0.0.1", "--port", String(port)];

  if (truthy(process.env.OBSCURA_STEALTH)) args.push("--stealth");
  if (truthy(process.env.OBSCURA_ALLOW_PRIVATE_NETWORK) || privateTarget(target.hostname)) {
    args.push("--allow-private-network");
  }
  if (process.env.OBSCURA_PROXY?.trim()) args.push("--proxy", process.env.OBSCURA_PROXY.trim());
  if (process.env.OBSCURA_STORAGE_DIR?.trim()) {
    args.push("--storage-dir", resolve(process.env.OBSCURA_STORAGE_DIR.trim()));
  }

  obscuraProcess = spawn(binary, args, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  managedObscura = true;
  obscuraProcess.stderr.on("data", (chunk) => process.stderr.write(`[obscura] ${chunk}`));
  obscuraProcess.once("error", (error) => {
    obscuraStartError = error;
    process.stderr.write(`[obscura] failed to start: ${error.message}\n`);
  });

  endpoint = `ws://127.0.0.1:${port}/devtools/browser`;
}

async function connectObscura(targetUrl) {
  if (browser) return;
  await launchObscura(targetUrl);

  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (obscuraStartError) throw obscuraStartError;
    if (obscuraProcess?.exitCode !== null && obscuraProcess?.exitCode !== undefined) {
      throw new Error(`obscura serve exited with code ${obscuraProcess.exitCode}`);
    }
    try {
      browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
      break;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  if (!browser) {
    throw new Error(
      `Could not connect to Obscura CDP at ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  page = await browser.newPage();
  attachDiagnostics(page);
  await page.setViewport({ ...DEFAULT_VIEWPORT, deviceScaleFactor: 1 });
}

function requirePage() {
  if (!page || page.isClosed()) throw new Error("Browser is not open. Call browser_navigate first.");
  return page;
}

async function viewport() {
  return requirePage().evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    devicePixelRatio: globalThis.devicePixelRatio || 1,
  }));
}

async function enforceOrigin() {
  if (!allowedOrigin) return;
  const current = requirePage().url();
  let currentOrigin = "";
  try {
    currentOrigin = new URL(current).origin;
  } catch {
    // Invalid/non-HTTP URLs are origin violations.
  }
  if (currentOrigin === allowedOrigin) return;

  if (openedUrl) {
    try {
      await requirePage().goto(openedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      // Preserve the origin violation as the primary error.
    }
  }
  throw new Error(
    `Browser action navigated outside allowed origin ${allowedOrigin} to ${current}; navigation was rejected.`,
  );
}

async function navigate(params) {
  const url = String(params?.url || "").trim();
  if (!url) throw new Error("browser_navigate requires url");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("browser_navigate requires an http(s) URL");
  }

  artifactDir = resolve(String(params?.artifactDir || "obscura-game-output"));
  mkdirSync(artifactDir, { recursive: true });
  allowedOrigin = String(params?.allowedOrigin || parsed.origin);
  if (parsed.origin !== allowedOrigin) {
    throw new Error(`Initial URL origin ${parsed.origin} does not match allowed origin ${allowedOrigin}`);
  }

  await connectObscura(url);
  openedUrl = url;
  await requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await enforceOrigin();
  return {
    endpoint,
    managed: managedObscura,
    ...(obscuraProcess?.pid ? { pid: obscuraProcess.pid } : {}),
    url: requirePage().url(),
    title: await requirePage().title(),
  };
}

async function snapshot() {
  const target = requirePage();
  const state = await target.evaluate(
    ({ refAttribute, maxTextChars, maxElements }) => {
      const visible = (element) => {
        const style = globalThis.getComputedStyle?.(element);
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
        const rect = element.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };

      for (const existing of document.querySelectorAll(`[${refAttribute}]`)) {
        existing.removeAttribute(refAttribute);
      }

      const selector = [
        "a[href]",
        "button",
        "input",
        "textarea",
        "select",
        "[role=button]",
        "[role=link]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=switch]",
        "[tabindex]",
      ].join(",");

      const elements = [];
      for (const element of document.querySelectorAll(selector)) {
        if (elements.length >= maxElements || !visible(element)) continue;
        const id = `e${elements.length}`;
        element.setAttribute(refAttribute, id);
        const text = String(element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
        const label = String(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("placeholder") ||
            "",
        ).trim();
        const value = "value" in element ? String(element.value ?? "") : "";
        elements.push({
          id,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || undefined,
          type: element.getAttribute("type") || undefined,
          text: text ? text.slice(0, 240) : undefined,
          label: label ? label.slice(0, 240) : undefined,
          value: value ? value.slice(0, 240) : undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        });
      }

      return {
        text: String(document.body?.innerText || "").slice(0, maxTextChars),
        elements,
      };
    },
    { refAttribute: REF_ATTRIBUTE, maxTextChars: MAX_TEXT_CHARS, maxElements: MAX_ELEMENTS },
  );

  return {
    url: redactUrl(target.url()),
    title: await target.title(),
    viewport: await viewport(),
    text: state.text,
    elements: state.elements.map((element) => ({
      ...element,
      ...(element.href ? { href: redactUrl(element.href) } : {}),
    })),
    diagnostics: diagnostics(),
  };
}

function refSelector(id) {
  if (!/^e\d+$/.test(id)) throw new Error(`Invalid snapshot element id: ${id}`);
  return `[${REF_ATTRIBUTE}="${id}"]`;
}

async function action(params) {
  const target = requirePage();
  const op = String(params?.op || "");
  const id = String(params?.id || "");
  const selector = refSelector(id);
  const value = params?.value === undefined ? undefined : String(params.value);
  const element = await target.$(selector);
  if (!element) throw new Error(`Snapshot element ${id} is stale; call browser_snapshot again.`);

  if (op === "click") await target.click(selector);
  else if (op === "hover") await target.hover(selector);
  else if (op === "type") {
    if (value === undefined) throw new Error("browser_action type requires value");
    await target.focus(selector);
    await target.type(selector, value, { delay: boundedInteger(params?.delayMs, 15, 0, 1000) });
  } else if (op === "fill") {
    if (value === undefined) throw new Error("browser_action fill requires value");
    await target.$eval(
      selector,
      (node, next) => {
        node.focus?.();
        node.value = next;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      },
      value,
    );
  } else if (op === "select") {
    if (value === undefined) throw new Error("browser_action select requires value");
    await target.select(selector, value);
  } else {
    throw new Error(`Unsupported browser_action op: ${op}`);
  }

  await sleep(100);
  await enforceOrigin();
  return { url: redactUrl(target.url()), title: await target.title() };
}

async function pointer(params) {
  const target = requirePage();
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("browser_pointer requires finite x/y");
  await target.mouse.click(x, y);
  await sleep(100);
  await enforceOrigin();
  return { url: redactUrl(target.url()), title: await target.title() };
}

async function key(params) {
  const target = requirePage();
  const keyName = String(params?.key || "").trim();
  if (!keyName) throw new Error("browser_key requires key");
  const holdMs = boundedInteger(params?.delayMs ?? params?.holdMs, 0, 0, 10_000);
  await target.keyboard.down(keyName);
  if (holdMs) await sleep(holdMs);
  await target.keyboard.up(keyName);
  await sleep(50);
  await enforceOrigin();
  return { url: redactUrl(target.url()), title: await target.title() };
}

async function wait(params) {
  await sleep(boundedInteger(params?.ms, 250, 0, 10_000));
}

async function back() {
  const target = requirePage();
  await target.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await enforceOrigin();
  return { url: redactUrl(target.url()), title: await target.title() };
}

async function screenshot(params) {
  const target = requirePage();
  if (!artifactDir) throw new Error("browser_navigate must run before browser_screenshot");
  const label = normalizeLabel(params?.label);
  const fullPage = Boolean(params?.fullPage);
  const filename = `${String(++screenshotIndex).padStart(2, "0")}-${label}.png`;
  const path = resolve(artifactDir, filename);
  try {
    await target.screenshot({ path, fullPage, type: "png" });
  } catch (error) {
    throw new Error(
      `Obscura screenshot failed. Use a rendering-enabled Obscura release (not a -no-render build). ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    path,
    filename: basename(path),
    bytes: statSync(path).size,
    url: redactUrl(target.url()),
    title: await target.title(),
    viewport: await viewport(),
    fullPage,
  };
}

async function sessionInfo() {
  return {
    endpoint: endpoint || String(process.env.OBSCURA_WS_ENDPOINT || ""),
    managed: managedObscura,
    ...(obscuraProcess?.pid ? { pid: obscuraProcess.pid } : {}),
    ...(page && !page.isClosed() ? { url: redactUrl(page.url()), title: await page.title() } : {}),
  };
}

async function closeBrowser() {
  if (browser) {
    try {
      await browser.disconnect();
    } catch {
      // best effort
    }
  }
  browser = undefined;
  page = undefined;

  if (managedObscura && obscuraProcess && obscuraProcess.exitCode === null) {
    obscuraProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => obscuraProcess.once("exit", resolvePromise)),
      sleep(2_000),
    ]);
    if (obscuraProcess.exitCode === null) obscuraProcess.kill("SIGKILL");
  }
  obscuraProcess = undefined;
  managedObscura = false;
}

async function dispatch(method, params) {
  switch (method) {
    case "navigate": return navigate(params);
    case "snapshot": return snapshot();
    case "action": return action(params);
    case "pointer": return pointer(params);
    case "key": return key(params);
    case "wait": return wait(params);
    case "back": return back();
    case "screenshot": return screenshot(params);
    case "sessionInfo": return sessionInfo();
    case "close": await closeBrowser(); return null;
    default: throw new Error(`Unknown Obscura worker method: ${method}`);
  }
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
input.on("line", (line) => {
  chain = chain.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      writeResponse({ id: null, ok: false, error: "Invalid JSON request" });
      return;
    }
    const id = request?.id ?? null;
    try {
      const result = await dispatch(String(request?.method || ""), request?.params);
      writeResponse({ id, ok: true, result });
    } catch (error) {
      writeResponse({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
});

async function shutdown() {
  try {
    await chain;
    await closeBrowser();
  } finally {
    process.exitCode = 0;
  }
}

input.on("close", () => { void shutdown(); });
process.on("SIGTERM", () => { input.close(); });
process.on("SIGINT", () => { input.close(); });
