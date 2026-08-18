import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createRequire } from "node:module"
import { createInterface } from "node:readline"
import { JsxAiError } from "../errors"
import type { RuntimeProgress } from "../internal/agent-runtime"
import type { JsonObject } from "../types"
import { JSX_AI_VERSION } from "../version"
import {
    codexEnvironment,
    codexOperationSignal,
    throwCodexOperationError,
    type CodexRuntimeCallOptions,
    type CodexRuntimeOptions,
} from "./codex-common"

interface PendingRequest {
    resolve(value: unknown): void
    reject(error: unknown): void
}

interface RpcNotification {
    method: string
    params?: unknown
}

interface CodexLaunch {
    command: string
    args: string[]
}

export interface CodexAppServerUsage {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
    modelContextWindow?: number
}

export interface CodexAppServerStreamStats {
    events: number
    progressEvents: number
    firstEventMs?: number
    firstStatusMs?: number
    durationMs: number
}

export interface CodexAppServerTurn {
    id: string
    finalResponse: string
    items: unknown[]
    usage?: CodexAppServerUsage
    stream: CodexAppServerStreamStats
}

export interface CodexAppServerTurnOptions extends CodexRuntimeCallOptions {
    outputSchema?: JsonObject
    onProgress?: (progress: RuntimeProgress) => void | Promise<void>
    onTextDelta?: (delta: string) => void | Promise<void>
}

type AppServerLauncher = (
    launch: CodexLaunch,
    env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams

const defaultLauncher: AppServerLauncher = (launch, env) =>
    spawn(launch.command, launch.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    })

let appServerLauncher: AppServerLauncher = defaultLauncher

/** Internal test seam; not re-exported from the package root. */
export function __setCodexAppServerLauncherForTests(launcher?: AppServerLauncher): void {
    appServerLauncher = launcher ?? defaultLauncher
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rpcError(value: unknown): Error {
    if (!isRecord(value)) return new Error("Codex app-server request failed")
    return new Error(typeof value.message === "string" ? value.message : "Codex app-server request failed")
}

class NotificationQueue {
    private readonly values: RpcNotification[] = []
    private readonly waiters: Array<{
        resolve(value: RpcNotification): void
        reject(error: unknown): void
    }> = []
    private closed = false
    private terminalError: unknown

    push(value: RpcNotification): void {
        const waiter = this.waiters.shift()
        if (waiter) {
            waiter.resolve(value)
            return
        }
        this.values.push(value)
    }

    fail(error: unknown): void {
        if (this.closed) return
        this.closed = true
        this.terminalError = error
        for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    }

    next(): Promise<RpcNotification> {
        const value = this.values.shift()
        if (value) return Promise.resolve(value)
        if (this.closed) {
            return Promise.reject(this.terminalError ?? new Error("Codex app-server closed"))
        }
        return new Promise<RpcNotification>((resolve, reject) => {
            this.waiters.push({ resolve, reject })
        })
    }
}

class CodexAppServerClient {
    private readonly child: ChildProcessWithoutNullStreams
    private readonly pending = new Map<number, PendingRequest>()
    private readonly notifications = new NotificationQueue()
    private nextId = 1
    private stderr = ""
    private closed = false

    constructor(launch: CodexLaunch, env: NodeJS.ProcessEnv) {
        this.child = appServerLauncher(launch, env)
        const stdout = createInterface({ input: this.child.stdout })
        stdout.on("line", line => this.handleLine(line))

        this.child.stderr.setEncoding("utf8")
        this.child.stderr.on("data", chunk => {
            this.stderr = `${this.stderr}${String(chunk)}`.slice(-12_000)
        })

        this.child.once("error", error => this.fail(error))
        this.child.once("exit", (code, signal) => {
            if (this.closed) return
            const details = this.stderr.trim()
            const suffix = details ? `\n${details}` : ""
            this.fail(
                new Error(
                    `Codex app-server exited before the turn completed (code=${code ?? "null"}, signal=${signal ?? "null"}).${suffix}`,
                ),
            )
        })
    }

    private write(value: unknown): void {
        if (this.closed || this.child.stdin.destroyed) {
            throw new Error("Codex app-server stdin is closed")
        }
        this.child.stdin.write(`${JSON.stringify(value)}\n`)
    }

    private handleLine(line: string): void {
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            return
        }
        if (!isRecord(parsed)) return

        if (typeof parsed.method === "string") {
            if (typeof parsed.id === "number") {
                // jsx-ai deliberately runs Codex as an inference backend. Approval
                // policy defaults to never, so an unexpected server request is a
                // protocol/configuration error rather than an interactive prompt.
                this.write({
                    id: parsed.id,
                    error: {
                        code: -32601,
                        message: `jsx-ai does not service Codex client request ${parsed.method}`,
                    },
                })
                return
            }
            this.notifications.push({
                method: parsed.method,
                ...(parsed.params !== undefined ? { params: parsed.params } : {}),
            })
            return
        }

        if (typeof parsed.id !== "number") return
        const pending = this.pending.get(parsed.id)
        if (!pending) return
        this.pending.delete(parsed.id)

        if (parsed.error !== undefined) {
            pending.reject(rpcError(parsed.error))
            return
        }
        pending.resolve(parsed.result)
    }

    private fail(error: unknown): void {
        if (this.closed) return
        this.closed = true
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
        this.notifications.fail(error)
    }

    request(method: string, params?: unknown): Promise<unknown> {
        const id = this.nextId++
        const promise = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
        })
        try {
            this.write({ id, method, ...(params !== undefined ? { params } : {}) })
        } catch (error) {
            this.pending.delete(id)
            throw error
        }
        return promise
    }

    notify(method: string, params?: unknown): void {
        this.write({ method, ...(params !== undefined ? { params } : {}) })
    }

    nextNotification(): Promise<RpcNotification> {
        return this.notifications.next()
    }

    async close(): Promise<void> {
        if (this.closed) return
        this.closed = true
        this.child.stdin.end()
        const exited = new Promise<void>(resolve => this.child.once("exit", () => resolve()))
        await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 500))])
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
        for (const pending of this.pending.values()) pending.reject(new Error("Codex app-server closed"))
        this.pending.clear()
        this.notifications.fail(new Error("Codex app-server closed"))
    }
}

function findCodexLaunch(options?: CodexRuntimeOptions): CodexLaunch {
    if (options?.codexPathOverride) {
        return { command: options.codexPathOverride, args: ["app-server", "--stdio"] }
    }

    const localRequire = createRequire(import.meta.url)
    let directError: unknown
    try {
        const cliEntry = localRequire.resolve("@openai/codex/bin/codex.js")
        return { command: process.execPath, args: [cliEntry, "app-server", "--stdio"] }
    } catch (error) {
        directError = error
    }

    // Backward compatibility for jsx-ai 0.14 installations that installed only
    // @openai/codex-sdk. The published SDK depends on @openai/codex, so resolve
    // the CLI from the SDK package scope when it is not hoisted to our scope.
    try {
        const sdkEntry = localRequire.resolve("@openai/codex-sdk")
        const sdkRequire = createRequire(sdkEntry)
        const cliEntry = sdkRequire.resolve("@openai/codex/bin/codex.js")
        return { command: process.execPath, args: [cliEntry, "app-server", "--stdio"] }
    } catch (sdkError) {
        throw new JsxAiError(
            "MISSING_RUNTIME_DEPENDENCY",
            "Codex runtime requires `@openai/codex`. Install it, then authenticate with `bunx @openai/codex login` (or `codex login`).",
            { cause: directError ?? sdkError },
        )
    }
}

function threadConfig(options?: CodexRuntimeOptions): JsonObject {
    const workspaceWrite: JsonObject = {
        network_access: options?.networkAccessEnabled ?? false,
        ...(options?.additionalDirectories?.length
            ? { writable_roots: [...options.additionalDirectories] }
            : {}),
    }

    return {
        web_search: options?.webSearchMode ?? "disabled",
        sandbox_workspace_write: workspaceWrite,
    }
}

function threadIdFromResponse(value: unknown): string {
    if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
        throw new JsxAiError("INVALID_RESPONSE", "Codex app-server thread/start returned no thread id")
    }
    return value.thread.id
}

function turnIdFromResponse(value: unknown): string {
    if (!isRecord(value) || !isRecord(value.turn) || typeof value.turn.id !== "string") {
        throw new JsxAiError("INVALID_RESPONSE", "Codex app-server turn/start returned no turn id")
    }
    return value.turn.id
}

function matchingIds(
    params: unknown,
    threadId: string,
    turnId: string,
): params is Record<string, unknown> {
    return isRecord(params) && params.threadId === threadId && params.turnId === turnId
}

function completedAgentText(
    params: unknown,
    threadId: string,
    turnId: string,
): string | undefined {
    if (!matchingIds(params, threadId, turnId) || !isRecord(params.item)) return undefined
    const item = params.item
    if (item.type !== "agentMessage" || typeof item.text !== "string") return undefined
    return item.text
}

function turnCompletion(
    params: unknown,
    threadId: string,
    turnId: string,
): { done: boolean; error?: string } {
    if (!isRecord(params) || params.threadId !== threadId || !isRecord(params.turn)) {
        return { done: false }
    }
    const turn = params.turn
    if (turn.id !== turnId) return { done: false }
    const status = typeof turn.status === "string" ? turn.status : "completed"
    if (status === "completed") return { done: true }
    const error =
        isRecord(turn.error) && typeof turn.error.message === "string"
            ? turn.error.message
            : `Codex turn ended with status ${status}`
    return { done: true, error }
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

function usageFromNotification(
    params: unknown,
    threadId: string,
    turnId: string,
): CodexAppServerUsage | undefined {
    if (!matchingIds(params, threadId, turnId) || !isRecord(params.tokenUsage)) return undefined
    const tokenUsage = params.tokenUsage
    if (!isRecord(tokenUsage.last)) return undefined
    const last = tokenUsage.last
    return {
        inputTokens: numberValue(last.inputTokens),
        cachedInputTokens: numberValue(last.cachedInputTokens),
        outputTokens: numberValue(last.outputTokens),
        reasoningOutputTokens: numberValue(last.reasoningOutputTokens),
        totalTokens: numberValue(last.totalTokens),
        ...(typeof tokenUsage.modelContextWindow === "number" && Number.isFinite(tokenUsage.modelContextWindow)
            ? { modelContextWindow: tokenUsage.modelContextWindow }
            : {}),
    }
}

function itemFromCompleted(
    params: unknown,
    threadId: string,
    turnId: string,
): unknown | undefined {
    if (!matchingIds(params, threadId, turnId) || !isRecord(params.item)) return undefined
    return params.item
}

function conciseText(value: unknown, limit = 220): string | undefined {
    if (typeof value !== "string") return undefined
    const text = value.replace(/\s+/g, " ").trim()
    if (!text) return undefined
    return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}

function progressFromNotification(
    event: RpcNotification,
    startedAt: number,
): RuntimeProgress | undefined {
    const elapsedMs = Date.now() - startedAt
    const params = isRecord(event.params) ? event.params : undefined

    if (event.method === "turn/started") {
        return { runtime: "codex", kind: "activity", message: "Codex turn started", elapsedMs }
    }

    if (event.method === "warning") {
        const message = conciseText(params?.message)
        if (!message) return undefined
        return { runtime: "codex", kind: "warning", message, elapsedMs }
    }

    if (event.method === "configWarning") {
        const message = conciseText(params?.summary ?? params?.details)
        if (!message) return undefined
        return { runtime: "codex", kind: "warning", message, elapsedMs }
    }

    if (event.method === "item/reasoning/summaryTextDelta") {
        const message = conciseText(params?.delta)
        if (!message) return undefined
        return {
            runtime: "codex",
            kind: "status",
            message,
            itemType: "reasoning",
            elapsedMs,
        }
    }

    if (event.method === "item/plan/delta") {
        const message = conciseText(params?.delta)
        if (!message) return undefined
        return {
            runtime: "codex",
            kind: "status",
            message,
            itemType: "plan",
            elapsedMs,
        }
    }

    if (event.method === "item/started" && isRecord(params?.item)) {
        const item = params.item
        const itemType = typeof item.type === "string" ? item.type : undefined
        const labels: Record<string, string> = {
            commandExecution: "Codex command started",
            fileChange: "Codex file-change item started",
            webSearch: "Codex web search started",
            mcpToolCall: "Codex MCP tool call started",
        }
        const message = itemType ? labels[itemType] : undefined
        if (!message) return undefined
        return { runtime: "codex", kind: "activity", message, itemType, elapsedMs }
    }

    return undefined
}

class AsyncTextQueue implements AsyncIterable<string> {
    private readonly values: string[] = []
    private readonly waiters: Array<{
        resolve(value: IteratorResult<string>): void
        reject(error: unknown): void
    }> = []
    private done = false
    private error: unknown

    push(value: string): void {
        if (this.done || !value) return
        const waiter = this.waiters.shift()
        if (waiter) {
            waiter.resolve({ value, done: false })
            return
        }
        this.values.push(value)
    }

    close(): void {
        if (this.done) return
        this.done = true
        for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
    }

    fail(error: unknown): void {
        if (this.done) return
        this.done = true
        this.error = error
        for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    }

    [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
            next: () => {
                const value = this.values.shift()
                if (value !== undefined) return Promise.resolve({ value, done: false })
                if (this.error !== undefined) return Promise.reject(this.error)
                if (this.done) return Promise.resolve({ value: undefined, done: true })
                return new Promise<IteratorResult<string>>((resolve, reject) => {
                    this.waiters.push({ resolve, reject })
                })
            },
        }
    }
}

export class CodexAppServerRuntime {
    private readonly client: CodexAppServerClient
    private closed = false

    private constructor(client: CodexAppServerClient) {
        this.client = client
    }

    static async create(options?: CodexRuntimeCallOptions): Promise<CodexAppServerRuntime> {
        const client = new CodexAppServerClient(
            findCodexLaunch(options?.codex),
            codexEnvironment(options?.codex, options?.apiKey),
        )
        try {
            await client.request("initialize", {
                clientInfo: { name: "jsx-ai", title: "jsx-ai", version: JSX_AI_VERSION },
            })
            client.notify("initialized", {})
            return new CodexAppServerRuntime(client)
        } catch (error) {
            await client.close()
            throw error
        }
    }

    async startThread(
        model: string | undefined,
        options?: CodexRuntimeOptions,
        ephemeral = true,
    ): Promise<CodexAppServerThread> {
        if (this.closed) throw new Error("Codex app-server runtime is closed")
        const result = await this.client.request("thread/start", {
            ...(model ? { model } : {}),
            ...(options?.workingDirectory ? { cwd: options.workingDirectory } : {}),
            sandbox: options?.sandboxMode ?? "read-only",
            approvalPolicy: options?.approvalPolicy ?? "never",
            config: threadConfig(options),
            ephemeral,
        })
        return new CodexAppServerThread(this, threadIdFromResponse(result), options)
    }

    async runTurn(
        threadId: string,
        input: string,
        runtimeOptions: CodexRuntimeOptions | undefined,
        options: CodexAppServerTurnOptions = {},
    ): Promise<CodexAppServerTurn> {
        if (this.closed) throw new Error("Codex app-server runtime is closed")
        const operation = codexOperationSignal(options.timeoutMs, options.signal)
        const closeOnAbort = () => void this.close()
        operation.signal.addEventListener("abort", closeOnAbort, { once: true })
        const startedAt = Date.now()

        try {
            const turnResult = await this.client.request("turn/start", {
                threadId,
                input: [{ type: "text", text: input }],
                ...(runtimeOptions?.modelReasoningEffort
                    ? { effort: runtimeOptions.modelReasoningEffort }
                    : {}),
                ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
            })
            const turnId = turnIdFromResponse(turnResult)
            const items: unknown[] = []
            let finalResponse = ""
            let deltaText = ""
            let usage: CodexAppServerUsage | undefined
            let events = 0
            let progressEvents = 0
            let firstEventMs: number | undefined
            let firstStatusMs: number | undefined

            while (true) {
                if (operation.signal.aborted) throw operation.signal.reason
                const event = await this.client.nextNotification()
                events++
                const elapsedMs = Date.now() - startedAt
                firstEventMs ??= elapsedMs

                if (
                    event.method === "item/agentMessage/delta" &&
                    matchingIds(event.params, threadId, turnId)
                ) {
                    const delta = isRecord(event.params) && typeof event.params.delta === "string"
                        ? event.params.delta
                        : ""
                    if (delta) {
                        deltaText += delta
                        await options.onTextDelta?.(delta)
                    }
                    continue
                }

                if (event.method === "thread/tokenUsage/updated") {
                    usage = usageFromNotification(event.params, threadId, turnId) ?? usage
                    continue
                }

                if (event.method === "item/completed") {
                    const item = itemFromCompleted(event.params, threadId, turnId)
                    if (item !== undefined) items.push(item)
                    finalResponse = completedAgentText(event.params, threadId, turnId) ?? finalResponse
                }

                if (event.method === "error" && matchingIds(event.params, threadId, turnId)) {
                    if (isRecord(event.params) && event.params.willRetry === true) continue
                    const message =
                        isRecord(event.params) && isRecord(event.params.error) && typeof event.params.error.message === "string"
                            ? event.params.error.message
                            : "Codex app-server turn failed"
                    throw new Error(message)
                }

                const progress = progressFromNotification(event, startedAt)
                if (progress) {
                    progressEvents++
                    if (progress.kind === "status") firstStatusMs ??= progress.elapsedMs
                    await options.onProgress?.(progress)
                }

                if (event.method === "turn/completed") {
                    const completion = turnCompletion(event.params, threadId, turnId)
                    if (!completion.done) continue
                    if (completion.error) throw new Error(completion.error)
                    const response = finalResponse || deltaText
                    if (!response) {
                        throw new JsxAiError(
                            "INVALID_RESPONSE",
                            "Codex app-server turn completed without an agent message",
                        )
                    }
                    return {
                        id: turnId,
                        finalResponse: response,
                        items,
                        ...(usage ? { usage } : {}),
                        stream: {
                            events,
                            progressEvents,
                            ...(firstEventMs !== undefined ? { firstEventMs } : {}),
                            ...(firstStatusMs !== undefined ? { firstStatusMs } : {}),
                            durationMs: Date.now() - startedAt,
                        },
                    }
                }
            }
        } catch (error) {
            throwCodexOperationError(error, operation, options.signal)
        } finally {
            operation.signal.removeEventListener("abort", closeOnAbort)
            operation.cleanup()
        }
    }

    async *streamTextTurn(
        threadId: string,
        input: string,
        runtimeOptions: CodexRuntimeOptions | undefined,
        options: CodexRuntimeCallOptions = {},
    ): AsyncGenerator<string> {
        const queue = new AsyncTextQueue()
        let streamedText = ""
        const turn = this.runTurn(threadId, input, runtimeOptions, {
            ...options,
            onTextDelta: delta => {
                streamedText += delta
                queue.push(delta)
            },
        }).then(
            result => {
                // Older/alternate Codex builds may expose only item/completed.
                if (!streamedText && result.finalResponse) queue.push(result.finalResponse)
                queue.close()
                return result
            },
            error => {
                queue.fail(error)
                throw error
            },
        )

        try {
            for await (const chunk of queue) yield chunk
            await turn
        } finally {
            // Absorb the background promise if the consumer stops iteration early.
            // The owner closes the runtime, which cancels any still-running turn.
            await turn.catch(() => undefined)
        }
    }

    async close(): Promise<void> {
        if (this.closed) return
        this.closed = true
        await this.client.close()
    }
}

export class CodexAppServerThread {
    constructor(
        private readonly runtime: CodexAppServerRuntime,
        readonly id: string,
        private readonly options?: CodexRuntimeOptions,
    ) {}

    run(input: string, options?: CodexAppServerTurnOptions): Promise<CodexAppServerTurn> {
        return this.runtime.runTurn(this.id, input, this.options, options)
    }

    streamText(input: string, options?: CodexRuntimeCallOptions): AsyncGenerator<string> {
        return this.runtime.streamTextTurn(this.id, input, this.options, options)
    }
}
