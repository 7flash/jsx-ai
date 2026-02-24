import { describe, test, expect } from "bun:test"
import { jsx, jsxs, Fragment } from "./jsx-runtime"
import { extract } from "./render"
import type { JsxAiNode } from "./types"

// ── Helper: build JSX nodes manually (since we can't use JSX syntax in .ts files) ──
const h = jsx

describe("jsx-runtime", () => {
    test("creates a tool node", () => {
        const node = h("tool", { name: "exec", description: "Run command" })
        expect(node.type).toBe("tool")
        expect((node as any).props.name).toBe("exec")
    })

    test("creates a message node with text children", () => {
        const node = h("message", { role: "user", children: "Hello world" })
        expect(node.type).toBe("message")
    })

    test("creates a system node", () => {
        const node = h("system", { children: "You are helpful" })
        expect(node.type).toBe("system")
    })

    test("creates a param node", () => {
        const node = h("param", { name: "query", type: "string", required: true, children: "Search query" })
        expect(node.type).toBe("param")
        expect((node as any).props.name).toBe("query")
    })

    test("creates a prompt node with config", () => {
        const node = h("prompt", { model: "gemini-2.5-flash", temperature: 0.5 })
        expect(node.type).toBe("prompt")
        expect((node as any).props.model).toBe("gemini-2.5-flash")
    })

    test("function components are called", () => {
        const MyTool = (props: any) => h("tool", { name: props.name, description: props.desc })
        const node = h(MyTool, { name: "search", desc: "Search web" })
        expect(node.type).toBe("tool")
        expect((node as any).props.name).toBe("search")
    })

    test("Fragment wraps children", () => {
        const node = Fragment({
            children: [
                h("message", { role: "user", children: "hi" }),
                h("message", { role: "assistant", children: "hello" }),
            ],
        })
        expect(node.type).toBe("fragment")
        expect((node as any).children.length).toBe(2)
    })
})

describe("extract", () => {
    test("extracts a complete prompt", () => {
        const tree = h("prompt", {
            model: "gemini-2.5-flash",
            temperature: 0.3,
            children: [
                h("system", { children: "You are a coding agent" }),
                h("tool", {
                    name: "exec",
                    description: "Run a shell command",
                    children: [
                        h("param", { name: "command", type: "string", required: true, children: "The command to run" }),
                    ],
                }),
                h("tool", {
                    name: "read_file",
                    description: "Read file contents",
                    children: [
                        h("param", { name: "path", type: "string", required: true, children: "File path" }),
                    ],
                }),
                h("message", { role: "user", children: "List files in src/" }),
            ],
        })

        const result = extract(tree)

        expect(result.model).toBe("gemini-2.5-flash")
        expect(result.temperature).toBe(0.3)
        expect(result.system).toBe("You are a coding agent")
        expect(result.tools.length).toBe(2)

        // Tool 1: exec
        expect(result.tools[0].name).toBe("exec")
        expect(result.tools[0].description).toBe("Run a shell command")
        expect(result.tools[0].parameters.properties.command.type).toBe("string")
        expect(result.tools[0].parameters.properties.command.description).toBe("The command to run")
        expect(result.tools[0].parameters.required).toEqual(["command"])

        // Tool 2: read_file
        expect(result.tools[1].name).toBe("read_file")
        expect(result.tools[1].parameters.properties.path.type).toBe("string")
        expect(result.tools[1].parameters.required).toEqual(["path"])

        // Messages
        expect(result.messages.length).toBe(1)
        expect(result.messages[0].role).toBe("user")
        expect(result.messages[0].content).toBe("List files in src/")
    })

    test("extracts tools with multiple params", () => {
        const tree = h("tool", {
            name: "edit_file",
            description: "Edit a file",
            children: [
                h("param", { name: "path", type: "string", required: true, children: "File path" }),
                h("param", { name: "search", type: "string", required: true, children: "Text to find" }),
                h("param", { name: "replace", type: "string", required: true, children: "Replacement" }),
            ],
        })

        const result = extract(tree)
        expect(result.tools.length).toBe(1)
        expect(Object.keys(result.tools[0].parameters.properties).length).toBe(3)
        expect(result.tools[0].parameters.required).toEqual(["path", "search", "replace"])
    })

    test("extracts param with enum", () => {
        const tree = h("tool", {
            name: "set_theme",
            description: "Change theme",
            children: [
                h("param", {
                    name: "mode",
                    type: "string",
                    required: true,
                    enum: ["light", "dark", "auto"],
                    children: "Theme mode",
                }),
            ],
        })

        const result = extract(tree)
        expect(result.tools[0].parameters.properties.mode.enum).toEqual(["light", "dark", "auto"])
    })

    test("handles prompt without tools", () => {
        const tree = h("prompt", {
            children: [
                h("system", { children: "You are helpful" }),
                h("message", { role: "user", children: "What is 2+2?" }),
            ],
        })

        const result = extract(tree)
        expect(result.tools.length).toBe(0)
        expect(result.messages.length).toBe(1)
        expect(result.system).toBe("You are helpful")
    })

    test("handles multiple messages", () => {
        const tree = h("prompt", {
            children: [
                h("message", { role: "user", children: "Hello" }),
                h("message", { role: "assistant", children: "Hi there!" }),
                h("message", { role: "user", children: "How are you?" }),
            ],
        })

        const result = extract(tree)
        expect(result.messages.length).toBe(3)
        expect(result.messages[0].content).toBe("Hello")
        expect(result.messages[1].role).toBe("assistant")
        expect(result.messages[2].content).toBe("How are you?")
    })

    test("handles fragment children", () => {
        const tools = Fragment({
            children: [
                h("tool", {
                    name: "a", description: "Tool A",
                    children: h("param", { name: "x", type: "string", required: true, children: "X param" }),
                }),
                h("tool", {
                    name: "b", description: "Tool B",
                    children: h("param", { name: "y", type: "string", required: true, children: "Y param" }),
                }),
            ],
        })

        const tree = h("prompt", {
            children: [
                tools,
                h("message", { role: "user", children: "Go" }),
            ],
        })

        const result = extract(tree)
        expect(result.tools.length).toBe(2)
        expect(result.tools[0].name).toBe("a")
        expect(result.tools[1].name).toBe("b")
        expect(result.messages.length).toBe(1)
    })

    test("strategy is extracted from prompt", () => {
        const tree = h("prompt", { strategy: "xml", children: [] })
        const result = extract(tree)
        expect(result.strategy).toBe("xml")
    })
})

describe("composable components", () => {
    // Demonstrate that function components enable reusable tool/prompt fragments

    const ExecTool = () =>
        h("tool", {
            name: "exec",
            description: "Run a shell command",
            children: h("param", { name: "command", type: "string", required: true, children: "Shell command" }),
        })

    const FileTool = () =>
        h("tool", {
            name: "read_file",
            description: "Read file contents",
            children: h("param", { name: "path", type: "string", required: true, children: "File path" }),
        })

    const CodingTools = () =>
        Fragment({
            children: [h(ExecTool, {}), h(FileTool, {})],
        })

    test("function components compose into a prompt", () => {
        const tree = h("prompt", {
            model: "gemini-2.5-flash",
            children: [
                h("system", { children: "You are a coding agent" }),
                h(CodingTools, {}),
                h("message", { role: "user", children: "Run the tests" }),
            ],
        })

        const result = extract(tree)
        expect(result.tools.length).toBe(2)
        expect(result.tools[0].name).toBe("exec")
        expect(result.tools[1].name).toBe("read_file")
        expect(result.messages[0].content).toBe("Run the tests")
    })
})

describe("native strategy", () => {
    const { native } = require("./strategies/native")

    test("builds correct request structure", () => {
        const prompt = extract(
            h("prompt", {
                model: "gemini-2.5-flash",
                children: [
                    h("system", { children: "You are helpful" }),
                    h("tool", {
                        name: "exec",
                        description: "Run command",
                        children: h("param", { name: "cmd", type: "string", required: true, children: "Command" }),
                    }),
                    h("message", { role: "user", children: "Run ls" }),
                ],
            })
        )

        const { url, body } = native.buildRequest(prompt, "test-key")

        expect(url).toContain("gemini-2.5-flash")
        expect(body.systemInstruction.parts[0].text).toBe("You are helpful")
        expect(body.tools[0].functionDeclarations.length).toBe(1)
        expect(body.tools[0].functionDeclarations[0].name).toBe("exec")
        expect(body.toolConfig.functionCallingConfig.mode).toBe("AUTO")
        expect(body.contents.length).toBe(1)
    })

    test("parses function call response", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { functionCall: { name: "exec", args: { cmd: "ls -la" } } },
                    ],
                },
            }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
        }

        const result = native.parseResponse(mockResponse)
        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe("exec")
        expect(result.toolCalls[0].args.cmd).toBe("ls -la")
        expect(result.usage?.inputTokens).toBe(100)
    })

    test("parses mixed text + tool call response", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: "I'll run the command for you." },
                        { functionCall: { name: "exec", args: { cmd: "ls" } } },
                    ],
                },
            }],
        }

        const result = native.parseResponse(mockResponse)
        expect(result.text).toBe("I'll run the command for you.")
        expect(result.toolCalls.length).toBe(1)
    })
})

describe("xml strategy", () => {
    const { xml } = require("./strategies/xml")

    test("builds request with full XML document as user content", () => {
        const prompt = extract(
            h("prompt", {
                model: "gemini-2.5-flash",
                strategy: "xml",
                children: [
                    h("system", { children: "You are helpful" }),
                    h("tool", {
                        name: "exec",
                        description: "Run command",
                        children: h("param", { name: "cmd", type: "string", required: true, children: "Command" }),
                    }),
                    h("message", { role: "user", children: "Run ls" }),
                ],
            })
        )

        const { body } = xml.buildRequest(prompt, "test-key")

        // Full XML strategy: no systemInstruction, everything in user content
        expect(body.systemInstruction).toBeUndefined()
        expect(body.contents.length).toBe(1)
        expect(body.contents[0].role).toBe("user")

        const text = body.contents[0].parts[0].text
        expect(text).toContain("<prompt>")
        expect(text).toContain("<system>You are helpful</system>")
        expect(text).toContain('<tool name="exec"')
        expect(text).toContain('<message role="user">')
        expect(text).toContain("<response_format>")
    })

    test("parses new-format XML response with <call> tags", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [{
                        text: `<response>
  <message>I'll list the files</message>
  <tool_calls>
    <call tool="exec">
      <param name="cmd">ls -la</param>
    </call>
  </tool_calls>
</response>`,
                    }],
                },
            }],
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
        }

        const result = xml.parseResponse(mockResponse)
        expect(result.text).toBe("I'll list the files")
        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe("exec")
        expect(result.toolCalls[0].args.cmd).toBe("ls -la")
    })

    test("parses legacy <invocation> format (backward compat)", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [{
                        text: `<response>
  <message>Reading and searching</message>
  <tool_invocations>
    <invocation>
      <tool>read_file</tool>
      <params><path>src/app.ts</path></params>
    </invocation>
    <invocation>
      <tool>search</tool>
      <params><pattern>*.test.ts</pattern><path>src</path></params>
    </invocation>
  </tool_invocations>
</response>`,
                    }],
                },
            }],
        }

        const result = xml.parseResponse(mockResponse)
        expect(result.toolCalls.length).toBe(2)
        expect(result.toolCalls[0].name).toBe("read_file")
        expect(result.toolCalls[0].args.path).toBe("src/app.ts")
        expect(result.toolCalls[1].name).toBe("search")
        expect(result.toolCalls[1].args.pattern).toBe("*.test.ts")
    })

    test("parses multiple new-format tool calls", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [{
                        text: `<response>
  <message>Creating files</message>
  <tool_calls>
    <call tool="write_file">
      <param name="path">src/server.ts</param>
      <param name="content">export default { port: 3000 }</param>
    </call>
    <call tool="write_file">
      <param name="path">src/test.ts</param>
      <param name="content">import { expect } from "bun:test"</param>
    </call>
  </tool_calls>
</response>`,
                    }],
                },
            }],
        }

        const result = xml.parseResponse(mockResponse)
        expect(result.toolCalls.length).toBe(2)
        expect(result.toolCalls[0].name).toBe("write_file")
        expect(result.toolCalls[0].args.path).toBe("src/server.ts")
        expect(result.toolCalls[1].name).toBe("write_file")
        expect(result.toolCalls[1].args.path).toBe("src/test.ts")
    })

    test("handles multi-part response", () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: `<response>\n  <message>Part 1</message>` },
                        { text: `  <tool_calls>\n    <call tool="exec">\n      <param name="cmd">ls</param>\n    </call>` },
                        { text: `  </tool_calls>\n</response>` },
                    ],
                },
            }],
        }

        const result = xml.parseResponse(mockResponse)
        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe("exec")
    })
})

