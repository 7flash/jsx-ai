import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join, basename } from "path"
import { tmpdir } from "os"

const repoRoot = join(import.meta.dir, "..").replace(/\\/g, "/")
const smokeSource = `
import { callLLM, callText, streamLLM, render, GeminiProvider, OpenAIProvider, AnthropicProvider, Skill, UseSkillTool, resolveSkills, native, xml, natural, nlt, hybrid } from "jsx-ai"
import { jsx, jsxs, Fragment } from "jsx-ai/jsx-runtime"
import { jsxDEV } from "jsx-ai/jsx-dev-runtime"

const tree = jsx("prompt", {
  model: "gpt-4o",
  provider: "openai",
  strategy: "xml",
  children: [
    jsx("system", { children: "You are helpful" }),
    jsx("message", { role: "user", children: "hi" }),
  ],
})

const extracted = render(tree)

if (typeof callLLM !== "function") throw new Error("callLLM export missing")
if (typeof callText !== "function") throw new Error("callText export missing")
if (typeof streamLLM !== "function") throw new Error("streamLLM export missing")
if (typeof render !== "function") throw new Error("render export missing")
if (typeof Skill !== "function" || typeof UseSkillTool !== "function" || typeof resolveSkills !== "function") throw new Error("skills exports missing")
if (typeof native?.prepare !== "function" || typeof xml?.prepare !== "function" || typeof natural?.prepare !== "function" || typeof nlt?.prepare !== "function" || typeof hybrid?.prepare !== "function") throw new Error("strategy exports missing")
if (typeof jsx !== "function" || typeof jsxs !== "function") throw new Error("jsx runtime exports missing")
if (typeof jsxDEV !== "function") throw new Error("jsx dev runtime export missing")
if (typeof Fragment !== "function") throw new Error("Fragment export missing")
if (!(new GeminiProvider()).name || !(new OpenAIProvider()).name || !(new AnthropicProvider()).name) throw new Error("provider exports missing")
if (tree.type !== "prompt") throw new Error("runtime import did not create prompt")
if (tree.props.provider !== "openai") throw new Error("prompt provider prop mismatch")
if (tree.props.strategy !== "xml") throw new Error("prompt strategy prop mismatch")
if (extracted.model !== "gpt-4o") throw new Error("render model mismatch")
if (extracted.strategy !== "xml") throw new Error("render strategy mismatch")
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

function runConsumerInstall(dependencySpecifier: string) {
    const dir = mkdtempSync(join(tmpdir(), "jsx-ai-consumer-"))

    try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            name: "jsx-ai-consumer-smoke",
            private: true,
            type: "module",
            dependencies: {
                "jsx-ai": dependencySpecifier,
            },
        }, null, 2))

        writeFileSync(join(dir, "smoke.tsx"), smokeSource)

        expectSuccess(run(["bun", "install"], dir), "bun install")
        const smokeRun = run(["bun", "run", "--install=fallback", "smoke.tsx"], dir)
        expectSuccess(smokeRun, "bun run smoke.tsx")
        expect(smokeRun.stdout.toString()).toContain("ok")
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

describe("package consumer smoke", () => {
    test("clean consumer project can import published-style entrypoints from file install", { timeout: 30000 }, () => {
        runConsumerInstall(`file:${repoRoot}`)
    })

    test("clean consumer project can import published-style entrypoints from packed tarball", { timeout: 30000 }, () => {
        const packDir = mkdtempSync(join(tmpdir(), "jsx-ai-pack-"))

        try {
            const pack = run(["bun", "pm", "pack", "--quiet", "--destination", packDir], repoRoot)
            expectSuccess(pack, "bun pm pack")

            const tarball = pack.stdout.toString().trim().split(/\r?\n/).filter(Boolean).pop()
            expect(tarball).toBeDefined()

            const tarballPath = tarball!.includes("/") || tarball!.includes("\\")
                ? tarball!
                : join(packDir, basename(tarball!)).replace(/\\/g, "/")

            runConsumerInstall(`file:${tarballPath.replace(/\\/g, "/")}`)
        } finally {
            rmSync(packDir, { recursive: true, force: true })
        }
    })
})
