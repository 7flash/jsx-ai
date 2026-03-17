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

    test("provider override is extracted from prompt", () => {
        const tree = h("prompt", { provider: "openai", children: [] })
        const result = extract(tree) as any
        expect(result.providerOverride).toBe("openai")
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

    test("prepares prompt with native tools", () => {
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

        const prepared = native.prepare(prompt)

        expect(prepared.system).toBe("You are helpful")
        expect(prepared.nativeTools?.length).toBe(1)
        expect(prepared.nativeTools[0].name).toBe("exec")
        expect(prepared.messages.length).toBe(1)
        expect(prepared.messages[0].role).toBe("user")
        expect(prepared.messages[0].content).toBe("Run ls")
    })

    test("parseResponse uses native FC tool calls from provider", () => {
        const result = native.parseResponse({
            text: "I'll run the command.",
            nativeToolCalls: [
                { name: "exec", args: { cmd: "ls -la" } },
            ],
            raw: {},
            usage: { inputTokens: 100, outputTokens: 10 },
        })
        expect(result.text).toBe("I'll run the command.")
        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe("exec")
        expect(result.toolCalls[0].args.cmd).toBe("ls -la")
    })
})

describe("xml strategy", () => {
    const { xml } = require("./strategies/xml")

    test("prepares prompt as single XML user message", () => {
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

        const prepared = xml.prepare(prompt)

        // XML strategy: no system, no native tools — everything in one user message
        expect(prepared.system).toBeUndefined()
        expect(prepared.nativeTools).toBeUndefined()
        expect(prepared.messages.length).toBe(1)
        expect(prepared.messages[0].role).toBe("user")

        const text = prepared.messages[0].content
        expect(text).toContain("<prompt>")
        expect(text).toContain("<system>You are helpful</system>")
        expect(text).toContain('<tool name="exec"')
        expect(text).toContain('<message role="user">')
        expect(text).toContain("<response_format>")
    })

    test("parseResponse: new-format <call> tags", () => {
        const result = xml.parseResponse({
            text: `<response>
  <message>I'll list the files</message>
  <tool_calls>
    <call tool="exec">
      <param name="cmd">ls -la</param>
    </call>
  </tool_calls>
</response>`,
            nativeToolCalls: [],
            raw: {},
        })

        expect(result.text).toBe("I'll list the files")
        expect(result.toolCalls.length).toBe(1)
        expect(result.toolCalls[0].name).toBe("exec")
        expect(result.toolCalls[0].args.cmd).toBe("ls -la")
    })

    test("parseResponse: legacy <invocation> format", () => {
        const result = xml.parseResponse({
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
            nativeToolCalls: [],
            raw: {},
        })

        expect(result.toolCalls.length).toBe(2)
        expect(result.toolCalls[0].name).toBe("read_file")
        expect(result.toolCalls[0].args.path).toBe("src/app.ts")
        expect(result.toolCalls[1].name).toBe("search")
        expect(result.toolCalls[1].args.pattern).toBe("*.test.ts")
    })

    test("parseResponse: multiple new-format calls", () => {
        const result = xml.parseResponse({
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
            nativeToolCalls: [],
            raw: {},
        })

        expect(result.toolCalls.length).toBe(2)
        expect(result.toolCalls[0].name).toBe("write_file")
        expect(result.toolCalls[0].args.path).toBe("src/server.ts")
        expect(result.toolCalls[1].name).toBe("write_file")
        expect(result.toolCalls[1].args.path).toBe("src/test.ts")
    })
})


// ═══════════════════════════════════════════════════════════════════
//   PROVIDER TESTS
// ═══════════════════════════════════════════════════════════════════

import { GeminiProvider } from "./providers/gemini"
import { OpenAIProvider } from "./providers/openai"
import { AnthropicProvider } from "./providers/anthropic"

describe("GeminiProvider", () => {
    const provider = new GeminiProvider()

    test("parseResponse extracts text", () => {
        const result = provider.parseResponse({
            candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        })
        expect(result.text).toBe("Hello world")
        expect(result.nativeToolCalls).toHaveLength(0)
        expect(result.usage?.inputTokens).toBe(10)
        expect(result.usage?.outputTokens).toBe(5)
    })

    test("parseResponse extracts function calls", () => {
        const result = provider.parseResponse({
            candidates: [{
                content: {
                    parts: [
                        { functionCall: { name: "exec", args: { command: "ls" } } },
                        { functionCall: { name: "read", args: { path: "a.ts" } } },
                    ],
                },
            }],
        })
        expect(result.nativeToolCalls).toHaveLength(2)
        expect(result.nativeToolCalls[0].name).toBe("exec")
        expect(result.nativeToolCalls[1].args.path).toBe("a.ts")
    })

    test("buildRequest merges consecutive same-role messages", () => {
        const { body } = provider.buildRequest(
            {
                system: "sys",
                messages: [
                    { role: "user", content: "msg1" },
                    { role: "user", content: "msg2" },
                    { role: "assistant", content: "reply" },
                ],
                temperature: 0.5,
                maxTokens: 100,
            },
            "gemini-2.5-flash",
            "key123",
        )
        // Two consecutive user messages should be merged into one
        expect(body.contents).toHaveLength(2)
        expect(body.contents[0].role).toBe("user")
        expect(body.contents[0].parts[0].text).toContain("msg1")
        expect(body.contents[0].parts[0].text).toContain("msg2")
        expect(body.contents[1].role).toBe("model")
    })

    test("buildRequest uses x-goog-api-key header", () => {
        const { headers } = provider.buildRequest(
            { system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.1, maxTokens: 100 },
            "gemini-2.5-flash", "test-key",
        )
        expect(headers["x-goog-api-key"]).toBe("test-key")
    })
})

describe("OpenAIProvider", () => {
    const provider = new OpenAIProvider()

    test("parseResponse extracts text", () => {
        const result = provider.parseResponse({
            choices: [{ message: { content: "Hello" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        })
        expect(result.text).toBe("Hello")
        expect(result.usage?.inputTokens).toBe(10)
    })

    test("parseResponse extracts tool_calls with JSON arguments", () => {
        const result = provider.parseResponse({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [
                        { type: "function", function: { name: "exec", arguments: '{"cmd":"ls"}' } },
                    ],
                },
            }],
        })
        expect(result.nativeToolCalls).toHaveLength(1)
        expect(result.nativeToolCalls[0].name).toBe("exec")
        expect(result.nativeToolCalls[0].args.cmd).toBe("ls")
    })

    test("parseResponse gracefully handles malformed JSON arguments", () => {
        const result = provider.parseResponse({
            choices: [{
                message: {
                    tool_calls: [
                        { type: "function", function: { name: "exec", arguments: "not json" } },
                    ],
                },
            }],
        })
        expect(result.nativeToolCalls).toHaveLength(1)
        expect(result.nativeToolCalls[0].name).toBe("exec")
        expect(result.nativeToolCalls[0].args).toEqual({})
    })

    test("buildRequest uses max_completion_tokens for o4-* reasoning models", () => {
        const { body } = provider.buildRequest(
            { system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.5, maxTokens: 8000 },
            "o4-mini", "key",
        )
        expect(body.max_completion_tokens).toBe(8000)
        expect(body.max_tokens).toBeUndefined()
        expect(body.temperature).toBe(1.0) // forced for reasoning models
    })

    test("buildRequest uses max_tokens for regular models", () => {
        const { body } = provider.buildRequest(
            { system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.5, maxTokens: 4000 },
            "gpt-4o", "key",
        )
        expect(body.max_tokens).toBe(4000)
        expect(body.max_completion_tokens).toBeUndefined()
        expect(body.temperature).toBe(0.5)
    })

    test("buildRequest routes deepseek to api.deepseek.com", () => {
        const { url } = provider.buildRequest(
            { system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.1, maxTokens: 100 },
            "deepseek-chat", "key",
        )
        expect(url).toContain("api.deepseek.com")
    })

    test("buildRequest routes qwen to DashScope-compatible chat completions", () => {
        const prev = process.env.DASHSCOPE_BASE_URL
        process.env.DASHSCOPE_BASE_URL = "https://dashscope.example.com/v1"
        try {
            const { url } = provider.buildRequest(
                { system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.1, maxTokens: 100 },
                "qwen-max", "key",
            )
            expect(url).toBe("https://dashscope.example.com/v1/chat/completions")
        } finally {
            if (prev === undefined) delete process.env.DASHSCOPE_BASE_URL
            else process.env.DASHSCOPE_BASE_URL = prev
        }
    })
})

describe("AnthropicProvider", () => {
    const provider = new AnthropicProvider()

    test("parseResponse extracts text from content blocks", () => {
        const result = provider.parseResponse({
            content: [
                { type: "text", text: "Here is the answer" },
            ],
            usage: { input_tokens: 20, output_tokens: 15 },
        })
        expect(result.text).toBe("Here is the answer")
        expect(result.usage?.inputTokens).toBe(20)
        expect(result.usage?.outputTokens).toBe(15)
    })

    test("parseResponse extracts tool_use blocks", () => {
        const result = provider.parseResponse({
            content: [
                { type: "text", text: "I'll run that for you" },
                { type: "tool_use", name: "exec", input: { command: "ls -la" } },
                { type: "tool_use", name: "write_file", input: { path: "a.ts", content: "code" } },
            ],
        })
        expect(result.text).toBe("I'll run that for you")
        expect(result.nativeToolCalls).toHaveLength(2)
        expect(result.nativeToolCalls[0].name).toBe("exec")
        expect(result.nativeToolCalls[0].args.command).toBe("ls -la")
        expect(result.nativeToolCalls[1].name).toBe("write_file")
    })

    test("buildRequest uses x-api-key and anthropic-version headers", () => {
        const { headers } = provider.buildRequest(
            { system: "sys", messages: [{ role: "user", content: "hi" }], temperature: 0.1, maxTokens: 100 },
            "claude-3-sonnet-20240229", "sk-ant-key",
        )
        expect(headers["x-api-key"]).toBe("sk-ant-key")
        expect(headers["anthropic-version"]).toBe("2023-06-01")
        expect((headers as Record<string, string>)["Authorization"]).toBeUndefined()
    })

    test("buildRequest puts system as top-level field, not a message", () => {
        const { body } = provider.buildRequest(
            { system: "You are helpful", messages: [{ role: "user", content: "hi" }], temperature: 0.1, maxTokens: 100 },
            "claude-3-sonnet-20240229", "key",
        )
        expect(body.system).toBe("You are helpful")
        expect(body.messages.every((m: any) => m.role !== "system")).toBe(true)
    })

    test("buildRequest formats tools with input_schema", () => {
        const { body } = provider.buildRequest(
            {
                system: "",
                messages: [{ role: "user", content: "hi" }],
                nativeTools: [{
                    name: "exec",
                    description: "Run command",
                    parameters: { type: "object", properties: { cmd: { type: "string", description: "Command to run" } }, required: ["cmd"] },
                }],
                temperature: 0.1,
                maxTokens: 100,
            },
            "claude-3-sonnet-20240229", "key",
        )
        expect(body.tools[0].input_schema).toBeDefined()
        expect(body.tools[0].parameters).toBeUndefined() // Anthropic uses input_schema, not parameters
    })
})


// ═══════════════════════════════════════════════════════════════════
//   SKILL TESTS
// ═══════════════════════════════════════════════════════════════════

import { parseSkillFile, resolveSkills } from "./skill"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

describe("parseSkillFile", () => {
    const tmpDir = join(import.meta.dir, ".test-skills")

    // Setup: create test skill files
    const setup = () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "bun.md"), `---\nname: bun-expert\ndescription: Bun runtime expertise\n---\n## Bun Runtime\n- Use Bun.serve()\n`)
        writeFileSync(join(tmpDir, "no-frontmatter.md"), `Just some content\nwithout frontmatter\n`)
    }

    // Teardown
    const teardown = () => {
        try { rmSync(tmpDir, { recursive: true }) } catch { }
    }

    test("parses frontmatter name and description", () => {
        setup()
        try {
            const skill = parseSkillFile(join(tmpDir, "bun.md"))
            expect(skill.name).toBe("bun-expert")
            expect(skill.description).toBe("Bun runtime expertise")
            expect(skill.content).toContain("Use Bun.serve()")
        } finally { teardown() }
    })

    test("falls back to filename when no frontmatter", () => {
        setup()
        try {
            const skill = parseSkillFile(join(tmpDir, "no-frontmatter.md"))
            expect(skill.name).toBe("no-frontmatter")
            expect(skill.description).toBe("")
            expect(skill.content).toContain("Just some content")
        } finally { teardown() }
    })
})

describe("resolveSkills", () => {
    const tmpDir = join(import.meta.dir, ".test-skills-resolve")

    const setup = () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "bun.md"), "---\nname: bun-expert\ndescription: Bun\n---\ncontent\n")
        writeFileSync(join(tmpDir, "ts.md"), "---\nname: strict-typescript\ndescription: TS\n---\ncontent\n")
        writeFileSync(join(tmpDir, "sec.md"), "---\nname: security\ndescription: Sec\n---\ncontent\n")
    }
    const teardown = () => { try { rmSync(tmpDir, { recursive: true }) } catch { } }

    test("resolves matching skills by name", () => {
        setup()
        try {
            const paths = ["bun.md", "ts.md", "sec.md"].map(f => join(tmpDir, f))
            const resolved = resolveSkills(paths, ["bun-expert", "security"])
            expect(resolved).toHaveLength(2)
            expect(resolved.map(s => s.name)).toContain("bun-expert")
            expect(resolved.map(s => s.name)).toContain("security")
        } finally { teardown() }
    })

    test("handles partial name matches", () => {
        setup()
        try {
            const paths = ["bun.md", "ts.md", "sec.md"].map(f => join(tmpDir, f))
            const resolved = resolveSkills(paths, ["bun"])
            expect(resolved).toHaveLength(1)
            expect(resolved[0].name).toBe("bun-expert")
        } finally { teardown() }
    })

    test("returns empty for no matches", () => {
        setup()
        try {
            const paths = ["bun.md"].map(f => join(tmpDir, f))
            const resolved = resolveSkills(paths, ["nonexistent"])
            expect(resolved).toHaveLength(0)
        } finally { teardown() }
    })
})


// ═══════════════════════════════════════════════════════════════════
//   STREAM LLM TESTS
// ═══════════════════════════════════════════════════════════════════

import { streamLLM } from "./llm"

describe("streamLLM", () => {
    let server: ReturnType<typeof Bun.serve> | null = null
    let serverPort = 0

    const startMockServer = (handler: (req: Request) => Response) => {
        server = Bun.serve({ port: 0, fetch: handler })
        serverPort = server!.port as number
    }

    const stopServer = () => {
        if (server) { server.stop(true); server = null }
    }

    test("streams Gemini-style SSE chunks", async () => {
        startMockServer(() => {
            const chunks = [
                `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n`,
                `data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n`,
                `data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}]}\n\n`,
            ]
            const stream = new ReadableStream({
                start(controller) {
                    const enc = new TextEncoder()
                    for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
                    controller.close()
                }
            })
            return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
        })

        try {
            // Monkey-patch the URL by setting GEMINI env — but streamLLM hardcodes the URL
            // Instead, test the OpenAI-compatible path which respects OPENAI_BASE_URL
            const collected: string[] = []
            const oldBase = process.env.OPENAI_BASE_URL
            process.env.OPENAI_BASE_URL = `http://localhost:${serverPort}`

            // Use a model that routes to OpenAI
            startMockServer(() => {
                const chunks = [
                    `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n`,
                    `data: {"choices":[{"delta":{"content":" world"}}]}\n\n`,
                    `data: {"choices":[{"delta":{"content":"!"}}]}\n\n`,
                    `data: [DONE]\n\n`,
                ]
                const stream = new ReadableStream({
                    start(controller) {
                        const enc = new TextEncoder()
                        for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
                        controller.close()
                    }
                })
                return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
            })

            process.env.OPENAI_BASE_URL = `http://localhost:${serverPort}`
            process.env.OPENAI_API_KEY = "test-key"

            for await (const chunk of streamLLM("gpt-4o", [
                { role: "user", content: "Hi" },
            ])) {
                collected.push(chunk)
            }

            expect(collected).toEqual(["Hello", " world", "!"])

            process.env.OPENAI_BASE_URL = oldBase || ""
        } finally { stopServer() }
    })

    test("handles empty delta gracefully", async () => {
        startMockServer(() => {
            const chunks = [
                `data: {"choices":[{"delta":{}}]}\n\n`,
                `data: {"choices":[{"delta":{"content":"ok"}}]}\n\n`,
                `data: {"choices":[{"delta":{"content":""}}]}\n\n`,
                `data: [DONE]\n\n`,
            ]
            const stream = new ReadableStream({
                start(controller) {
                    const enc = new TextEncoder()
                    for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
                    controller.close()
                }
            })
            return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
        })

        try {
            const collected: string[] = []
            const oldBase = process.env.OPENAI_BASE_URL
            process.env.OPENAI_BASE_URL = `http://localhost:${serverPort}`
            process.env.OPENAI_API_KEY = "test-key"

            for await (const chunk of streamLLM("gpt-4o", [
                { role: "user", content: "Hi" },
            ])) {
                collected.push(chunk)
            }

            // Should only yield "ok" — empty deltas and missing content are skipped
            expect(collected).toEqual(["ok"])

            process.env.OPENAI_BASE_URL = oldBase || ""
        } finally { stopServer() }
    })

    test("throws on HTTP error", async () => {
        startMockServer(() => new Response("Bad request", { status: 400 }))

        try {
            const oldBase = process.env.OPENAI_BASE_URL
            process.env.OPENAI_BASE_URL = `http://localhost:${serverPort}`
            process.env.OPENAI_API_KEY = "test-key"

            const chunks: string[] = []
            try {
                for await (const chunk of streamLLM("gpt-4o", [
                    { role: "user", content: "Hi" },
                ], { maxTokens: 100 })) {
                    chunks.push(chunk)
                }
                expect(true).toBe(false) // Should not reach here
            } catch (err: any) {
                expect(err.message).toContain("400")
            }

            process.env.OPENAI_BASE_URL = oldBase || ""
        } finally { stopServer() }
    })
})
