import { describe, expect, test } from "bun:test"
import { runAgent } from "./agent"
import type { JsxAiNode, LLMResponse, ToolCall } from "./types"

const emptyTree: JsxAiNode = { type: "fragment", children: [] }

function response(toolCalls: ToolCall[], text = "", inputTokens = 10, outputTokens = 5): LLMResponse {
    return {
        text,
        toolCalls,
        raw: {},
        usage: { inputTokens, outputTokens },
    }
}

describe("runAgent", () => {
    test("preserves canonical history, assigns missing IDs, and stops on completion", async () => {
        const calls: LLMResponse[] = [
            response([{ name: "write_file", args: { path: "a.txt", content: "hello" } }]),
            response([{ name: "done", args: { summary: "complete" } }]),
        ]
        const executed: string[] = []

        const result = await runAgent({
            history: [{ role: "user", content: "build it" }],
            buildPrompt: () => emptyTree,
            call: async () => calls.shift()!,
            executeTool: call => {
                executed.push(call.name)
                return `${call.name} ok`
            },
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
        })

        expect(result.reason).toBe("completed")
        expect(executed).toEqual(["write_file", "done"])
        expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10, thinkingTokens: 0 })

        const assistant = result.history.find(message => message.role === "assistant" && message.toolCalls?.[0]?.name === "write_file")
        const tool = result.history.find(message => message.role === "tool" && message.toolName === "write_file")
        expect(assistant?.toolCalls?.[0]?.id).toBeTruthy()
        expect(tool?.toolCallId).toBe(assistant?.toolCalls?.[0]?.id)
    })

    test("can recover from a no-tool model turn", async () => {
        let index = 0
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => index++ === 0
                ? response([], "I will explain instead")
                : response([{ name: "done", args: {} }]),
            executeTool: () => "ok",
            onNoToolCalls: () => "Use the tools and continue.",
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
        })

        expect(result.reason).toBe("completed")
        expect(result.history.some(message => message.role === "user" && message.content === "Use the tools and continue.")).toBe(true)
    })

    test("exposes one simple assistant-text callback even for buffered runtimes", async () => {
        const deltas: string[] = []
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([{ name: "done", args: {} }], "I am finishing now."),
            executeTool: () => "ok",
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
            onTextDelta: event => { deltas.push(event.delta) },
        })

        expect(deltas).toEqual(["I am finishing now."])
        expect(deltas.join("")).toBe(result.steps[0]?.response.text)
    })

    test("exposes semantic tool progress for buffered runtimes before execution", async () => {
        const progress: string[] = []
        let executed = false

        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([{
                name: "write_file",
                args: { path: "game.js", content: "console.log('ready')" },
            }], "I will update the file."),
            executeTool: _call => {
                expect(progress.at(-1)).toBe("tool_ready:write_file")
                executed = true
                return "ok"
            },
            isComplete: model => model.toolCalls.some(call => call.name === "write_file"),
            onToolProgress: event => {
                expect(executed).toBe(false)
                if (event.type === "tool_detected") progress.push(`tool_detected:${event.name}`)
                if (event.type === "field_ready") progress.push(`field_ready:${event.path.join(".")}`)
                if (event.type === "tool_ready") progress.push(`tool_ready:${event.call.name}`)
            },
        })

        expect(result.reason).toBe("completed")
        expect(executed).toBe(true)
        expect(progress).toEqual([
            "tool_detected:write_file",
            "field_ready:path",
            "field_ready:content",
            "tool_ready:write_file",
        ])
    })

    test("exposes one ordered UI stream through onEvent alone", async () => {
        const order: string[] = []
        let textHandlerFinished = false

        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([{
                name: "write_file",
                args: { path: "game.js", content: "console.log('ready')" },
            }], "I will update the file."),
            executeTool: () => {
                order.push("execute")
                return "ok"
            },
            isComplete: model => model.toolCalls.some(call => call.name === "write_file"),
            onEvent: async event => {
                if (event.type === "model_start") order.push("model_start")
                if (event.type === "text_delta") {
                    order.push(`text:${event.delta}`)
                    await Promise.resolve()
                    textHandlerFinished = true
                }
                if (event.type === "tool_progress") {
                    expect(textHandlerFinished).toBe(true)
                    if (event.progress.type === "tool_detected") order.push(`prepare:${event.progress.name}`)
                    if (event.progress.type === "field_ready") order.push(`field:${event.progress.path.join(".")}`)
                    if (event.progress.type === "tool_ready") order.push(`ready:${event.progress.call.name}`)
                }
                if (event.type === "model_end") order.push("model_end")
                if (event.type === "tool_start") order.push(`tool_start:${event.call.name}`)
                if (event.type === "tool_end") order.push(`tool_end:${event.call.name}`)
                if (event.type === "stop") order.push(`stop:${event.reason}`)
            },
        })

        expect(result.reason).toBe("completed")
        expect(order).toEqual([
            "model_start",
            "text:I will update the file.",
            "prepare:write_file",
            "field:path",
            "field:content",
            "ready:write_file",
            "model_end",
            "tool_start:write_file",
            "execute",
            "tool_end:write_file",
            "stop:completed",
        ])
    })

    test("does not partially execute a batch that exceeds the tool budget", async () => {
        let executions = 0
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([
                { name: "a", args: {} },
                { name: "b", args: {} },
            ]),
            executeTool: () => {
                executions++
                return "ok"
            },
            maxToolCalls: 1,
        })

        expect(result.reason).toBe("max_tool_calls")
        expect(executions).toBe(0)
        expect(result.toolCallsExecuted).toBe(0)
        const skipped = result.history.filter(message => message.role === "tool")
        expect(skipped).toHaveLength(2)
        expect(skipped.every(message => message.isError)).toBe(true)
    })

    test("stops before another model call when an output-token budget is reached", async () => {
        let modelCalls = 0
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => {
                modelCalls++
                return response([{ name: "work", args: {} }], "", 1, 8)
            },
            executeTool: () => "ok",
            maxOutputTokens: 8,
        })

        expect(result.reason).toBe("max_output_tokens")
        expect(modelCalls).toBe(1)
        expect(result.toolCallsExecuted).toBe(1)
    })
    test("event contexts are snapshots rather than live mutable history views", async () => {
        let firstHistoryLength: number | undefined
        let firstContextHistory: readonly unknown[] | undefined
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([{ name: "done", args: {} }]),
            executeTool: () => "ok",
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
            onEvent: event => {
                if (event.type === "model_start" && event.context.step === 0) {
                    firstHistoryLength = event.context.history.length
                    firstContextHistory = event.context.history
                }
            },
        })

        expect(firstHistoryLength).toBe(0)
        expect(firstContextHistory).toHaveLength(0)
        expect(result.history.length).toBeGreaterThan(0)
    })


    test("combines run-level and call-level cancellation signals", async () => {
        const runController = new AbortController()
        const callController = new AbortController()
        let receivedSignal: AbortSignal | undefined

        const result = await runAgent({
            buildPrompt: () => emptyTree,
            signal: runController.signal,
            callOptions: { signal: callController.signal },
            call: async (_tree, options) => {
                receivedSignal = options?.signal
                callController.abort(new Error("cancelled by call options"))
                throw new Error("cancelled")
            },
            executeTool: () => "unused",
        })

        expect(receivedSignal?.aborted).toBe(true)
        expect(result.reason).toBe("aborted")
    })

    test("freezes dispatched tool arguments and converts mismatched executor history into a paired error result", async () => {
        let argsWereFrozen = false
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async () => response([{ name: "write_file", args: { nested: { value: 1 } } }]),
            executeTool: call => {
                argsWereFrozen = Object.isFrozen(call.args) && Object.isFrozen(call.args.nested)
                return { role: "tool", content: "bad pairing", toolCallId: "wrong", toolName: call.name }
            },
            maxSteps: 1,
        })

        expect(argsWereFrozen).toBe(true)
        const assistant = result.history.find(message => message.role === "assistant")
        const tool = result.history.find(message => message.role === "tool")
        expect(tool?.isError).toBe(true)
        expect(tool?.toolCallId).toBe(assistant?.toolCalls?.[0]?.id)
        expect(tool?.content).toContain("expected")
    })

    test("does not turn the whole-run duration budget into a per-call timeout", async () => {
        let receivedTimeout: number | undefined = 123
        const result = await runAgent({
            buildPrompt: () => emptyTree,
            call: async (_tree, options) => {
                receivedTimeout = options?.timeoutMs
                return response([{ name: "done", args: {} }])
            },
            executeTool: () => "ok",
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
            maxDurationMs: 8 * 60_000,
        })

        expect(receivedTimeout).toBeUndefined()
        expect(result.reason).toBe("completed")
    })

    test("preserves an explicit per-call timeout independently of maxDurationMs", async () => {
        let receivedTimeout: number | undefined
        await runAgent({
            buildPrompt: () => emptyTree,
            callOptions: { timeoutMs: 12_345 },
            call: async (_tree, options) => {
                receivedTimeout = options?.timeoutMs
                return response([{ name: "done", args: {} }])
            },
            executeTool: () => "ok",
            isComplete: model => model.toolCalls.some(call => call.name === "done"),
            maxDurationMs: 8 * 60_000,
        })

        expect(receivedTimeout).toBe(12_345)
    })

})
