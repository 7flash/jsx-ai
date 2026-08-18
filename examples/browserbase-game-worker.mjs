#!/usr/bin/env node
/**
 * Node sidecar for examples/browserbase-game-agent.tsx.
 *
 * Browserbase's current Playwright quickstart documents Node.js/Python and notes
 * that Bun does not currently support Playwright. The Bun agent therefore keeps
 * Browserbase + Playwright in this tiny JSONL worker instead of changing the
 * runtime of the whole jsx-ai example.
 *
 * Protocol: one JSON object per line on stdin/stdout.
 * stdout is reserved for protocol responses; diagnostics belong on stderr.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import Browserbase from "@browserbasehq/sdk"
import { chromium } from "playwright-core"

const MAX_DIAGNOSTICS = 40
const MAX_ARIA_CHARS = 12_000
const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

let bb
let session
let browser
let context
let page
let screenshotIndex = 0
let artifactDir
let allowedOrigin
let openedUrl
const consoleMessages = []
const pageErrors = []
const failedRequests = []

function redactUrl(value) {
    try {
        const url = new URL(String(value))
        url.username = ""
        url.password = ""
        url.search = ""
        url.hash = ""
        return url.toString()
    } catch {
        return String(value).slice(0, 2000)
    }
}

function trimDiagnostics(items) {
    if (items.length > MAX_DIAGNOSTICS) items.splice(0, items.length - MAX_DIAGNOSTICS)
}

function normalizeLabel(value) {
    const text = String(value || "snapshot")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return text.slice(0, 80) || "snapshot"
}

function boundedInteger(value, fallback, min, max) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return fallback
    return Math.min(max, Math.max(min, Math.round(numeric)))
}

function requirePage() {
    if (!page || page.isClosed()) throw new Error("Browser is not open. Call game_open first.")
    return page
}

function attachDiagnostics(target) {
    target.on("console", message => {
        const type = message.type()
        if (type !== "error" && type !== "warning") return
        consoleMessages.push({ type, text: message.text().slice(0, 2000) })
        trimDiagnostics(consoleMessages)
    })

    target.on("pageerror", error => {
        pageErrors.push(String(error?.stack || error?.message || error).slice(0, 4000))
        trimDiagnostics(pageErrors)
    })

    target.on("requestfailed", request => {
        failedRequests.push({
            url: redactUrl(request.url()),
            error: request.failure()?.errorText || "request failed",
        })
        trimDiagnostics(failedRequests)
    })
}

function currentDiagnostics() {
    return {
        console: [...consoleMessages],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
    }
}

async function openBrowser(params) {
    if (!process.env.BROWSERBASE_API_KEY?.trim()) {
        throw new Error("BROWSERBASE_API_KEY is required by the Browserbase sidecar.")
    }

    const url = String(params?.url || "").trim()
    if (!url) throw new Error("game_open requires a URL")

    artifactDir = resolve(String(params?.artifactDir || "browserbase-game-output"))
    mkdirSync(artifactDir, { recursive: true })

    if (browser) await closeBrowser()

    bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY })
    session = await bb.sessions.create({
        timeout: boundedInteger(params?.timeoutSeconds, 1800, 60, 21600),
        browserSettings: {
            viewport: DEFAULT_VIEWPORT,
        },
        userMetadata: {
            example: "jsx-ai-browserbase-game-agent",
        },
    })

    browser = await chromium.connectOverCDP(session.connectUrl)
    context = browser.contexts()[0]
    if (!context) throw new Error("Browserbase session did not expose its recorded default context")
    page = context.pages()[0] || await context.newPage()
    attachDiagnostics(page)

    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)
    await page.goto(url, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(500)
    openedUrl = page.url()
    allowedOrigin = new URL(openedUrl).origin

    let debuggerUrl
    try {
        debuggerUrl = (await bb.sessions.debug(session.id)).debuggerUrl
    } catch {
        // Session inspection is helpful but not required for test execution.
    }

    return {
        sessionId: session.id,
        debuggerUrl,
        recordingUrl: `https://browserbase.com/sessions/${session.id}`,
        url: redactUrl(page.url()),
        title: await page.title(),
        viewport: await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        })),
    }
}


async function enforceGameOrigin(target) {
    if (!allowedOrigin) return
    const current = target.url()
    let origin
    try {
        origin = new URL(current).origin
    } catch {
        origin = ""
    }
    if (origin === allowedOrigin) return

    if (openedUrl) {
        try {
            await target.goto(openedUrl, { waitUntil: "domcontentloaded" })
            await target.waitForTimeout(250)
        } catch {
            // Preserve the navigation violation as the primary error.
        }
    }
    throw new Error(`Game action navigated outside the configured origin (${allowedOrigin}) to ${current}; navigation was rejected.`)
}

async function pressKey(params) {
    const target = requirePage()
    const key = String(params?.key || "").trim()
    if (!key) throw new Error("game_press requires a key")
    const holdMs = boundedInteger(params?.holdMs, 0, 0, 10_000)

    if (holdMs > 0) {
        await target.keyboard.down(key)
        try {
            await target.waitForTimeout(holdMs)
        } finally {
            await target.keyboard.up(key)
        }
    } else {
        await target.keyboard.press(key)
    }
    await enforceGameOrigin(target)

    return { key, holdMs }
}

async function clickPoint(params) {
    const target = requirePage()
    const x = Number(params?.x)
    const y = Number(params?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("game_click requires finite x and y coordinates")
    }
    await target.mouse.click(x, y)
    await target.waitForTimeout(100)
    await enforceGameOrigin(target)
    return { x, y }
}

async function waitForGame(params) {
    const target = requirePage()
    const ms = boundedInteger(params?.ms, 500, 0, 10_000)
    await target.waitForTimeout(ms)
    await enforceGameOrigin(target)
    return { ms }
}

async function snapshotGame(params) {
    const target = requirePage()
    if (!artifactDir) throw new Error("Browser artifact directory was not initialized")

    const label = normalizeLabel(params?.label)
    const index = ++screenshotIndex
    const filename = `${String(index).padStart(2, "0")}-${label}.png`
    const path = resolve(artifactDir, filename)
    const bytes = await target.screenshot({ type: "png", animations: "disabled" })
    writeFileSync(path, bytes)

    let ariaSnapshot = ""
    try {
        if (typeof target.ariaSnapshot === "function") {
            ariaSnapshot = String(await target.ariaSnapshot()).slice(0, MAX_ARIA_CHARS)
        }
    } catch {
        // Canvas-heavy games may expose little/no useful accessibility structure.
    }

    return {
        path,
        filename,
        bytes: bytes.length,
        url: redactUrl(target.url()),
        title: await target.title(),
        viewport: await target.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        })),
        ariaSnapshot,
        diagnostics: currentDiagnostics(),
    }
}

async function closeBrowser() {
    const closingBrowser = browser
    const closingSession = session
    browser = undefined
    context = undefined
    page = undefined
    session = undefined
    allowedOrigin = undefined
    openedUrl = undefined

    if (closingBrowser) {
        try {
            await closingBrowser.close()
        } catch {
            // Best effort: Browserbase will terminate a disconnected non-keepalive session.
        }
    }

    if (bb && closingSession) {
        try {
            await bb.sessions.update(closingSession.id, { status: "REQUEST_RELEASE" })
        } catch {
            // It may already be complete after the CDP client disconnects.
        }
    }

    return closingSession ? { sessionId: closingSession.id } : { sessionId: null }
}

async function dispatch(method, params) {
    switch (method) {
        case "open": return openBrowser(params)
        case "press": return pressKey(params)
        case "click": return clickPoint(params)
        case "wait": return waitForGame(params)
        case "snapshot": return snapshotGame(params)
        case "close": return closeBrowser()
        default: throw new Error(`Unknown Browserbase sidecar method: ${method}`)
    }
}

function writeResponse(payload) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
let chain = Promise.resolve()

input.on("line", line => {
    chain = chain.then(async () => {
        let request
        try {
            request = JSON.parse(line)
        } catch (error) {
            writeResponse({ id: null, ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` })
            return
        }

        const id = request?.id ?? null
        try {
            const result = await dispatch(String(request?.method || ""), request?.params)
            writeResponse({ id, ok: true, result })
        } catch (error) {
            writeResponse({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
    })
})

async function shutdown() {
    try {
        await chain
        await closeBrowser()
    } finally {
        process.exitCode = 0
    }
}

input.on("close", () => { void shutdown() })
process.on("SIGTERM", () => { input.close() })
process.on("SIGINT", () => { input.close() })
