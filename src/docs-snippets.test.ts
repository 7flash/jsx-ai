import { describe, test } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const repoRoot = join(import.meta.dir, "..").replace(/\\/g, "/")
const docsSnippetSource = `/** @jsxImportSource jsx-ai */
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { callText, streamLLM, render, registerStrategy, registerProvider, registerHook, Skill, UseSkillTool, resolveSkills, md } from "jsx-ai"

if (typeof callText !== "function") throw new Error("callText snippet import missing")
if (typeof streamLLM !== "function") throw new Error("streamLLM snippet import missing")
if (typeof render !== "function") throw new Error("render snippet import missing")
if (typeof Skill !== "function" || typeof UseSkillTool !== "function") throw new Error("skill snippet exports missing")
if (typeof md !== "function") throw new Error("md export missing")

registerHook(() => {})
registerStrategy("snippet-strategy", {
  name: "snippet-strategy",
  prepare(prompt) {
    return {
      system: prompt.system,
      messages: [{ role: "user", content: "hello" }],
    }
  },
  parseResponse(response) {
    return { text: response.text, toolCalls: [] }
  },
})
registerProvider("snippet-provider", {
  name: "snippet-provider",
  buildRequest() {
    return {
      url: "https://example.com",
      headers: { "Content-Type": "application/json" },
      body: {},
    }
  },
  parseResponse(data) {
    return { text: data?.text || "", nativeToolCalls: [], raw: data }
  },
})

const quickstartPrompt = (
  <>
    <system>You are a helpful coding assistant.</system>
    <tool name="exec" description="Run a shell command">
      <param name="command" type="string" required>The command to run</param>
    </tool>
    <message role="user">List all TypeScript files in this project.</message>
  </>
)

const quickstartExtracted = render(quickstartPrompt)
if (quickstartExtracted.tools[0]?.name !== "exec") throw new Error("quickstart snippet tool mismatch")
if (quickstartExtracted.messages[0]?.role !== "user") throw new Error("quickstart snippet message mismatch")

const providerPrompt = (
  <prompt model="custom-openai-route" provider="openai" strategy="xml">
    <message role="user">Hello</message>
  </prompt>
)
const providerExtracted = render(providerPrompt)
if (providerPrompt.type !== "prompt") throw new Error("provider snippet prompt type mismatch")
if (providerPrompt.props.provider !== "openai") throw new Error("provider snippet provider prop mismatch")
if (providerExtracted.model !== "custom-openai-route") throw new Error("provider snippet model mismatch")
if (providerExtracted.strategy !== "xml") throw new Error("provider snippet strategy mismatch")

const markdown = md\`
  Hello
    from md
\`
if (!markdown.includes("Hello")) throw new Error("md snippet failed")

const skillsDir = mkdtempSync(join(tmpdir(), "jsx-ai-skill-snippet-"))
try {
  const skillPath = join(skillsDir, "bun-expert.md")
  writeFileSync(skillPath, [
    "---",
    "name: bun-expert",
    "description: Bun runtime expertise",
    "---",
    "## Bun Runtime",
    "- Use Bun.serve()",
  ].join("\\n"))

  const skillPrompt = (
    <>
      <Skill path={skillPath} />
      <UseSkillTool />
      <message role="user">Build a Bun API</message>
    </>
  )
  const skillExtracted = render(skillPrompt)
  if (!skillExtracted.system?.includes("Available skill: bun-expert")) throw new Error("skill discovery snippet failed")

  const resolved = resolveSkills([skillPath], ["bun-expert"])
  if (resolved.length !== 1) throw new Error("resolveSkills snippet failed")
} finally {
  rmSync(skillsDir, { recursive: true, force: true })
}

console.log("ok")
`

function run(command: string[], cwd: string) {
    return Bun.spawnSync(command, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
    })
}

function expectSuccess(result: ReturnType<typeof Bun.spawnSync>, label: string) {
    if (result.exitCode !== 0) {
        throw new Error(`${label} failed\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`)
    }
}

describe("docs snippet smoke", () => {
    test("guide snippets stay runnable in a clean consumer project", { timeout: 30000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), "jsx-ai-docs-snippets-"))

        try {
            writeFileSync(join(dir, "package.json"), JSON.stringify({
                name: "jsx-ai-docs-snippets-smoke",
                private: true,
                type: "module",
                dependencies: {
                    "jsx-ai": `file:${repoRoot}`,
                },
            }, null, 2))

            writeFileSync(join(dir, "snippets.tsx"), docsSnippetSource)

            expectSuccess(run(["bun", "install"], dir), "bun install")
            const smokeRun = run(["bun", "run", "--install=fallback", "snippets.tsx"], dir)
            expectSuccess(smokeRun, "bun run snippets.tsx")
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
