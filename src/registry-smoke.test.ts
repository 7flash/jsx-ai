import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const registrySpec = process.env.REGISTRY_SMOKE_SPEC
const smokeSource = `
import { callLLM, GeminiProvider } from "jsx-ai"
import { jsx, jsxs, Fragment } from "jsx-ai/jsx-runtime"
import { jsxDEV } from "jsx-ai/jsx-dev-runtime"

const tree = jsx("prompt", {
  model: "gpt-4o",
  children: [
    jsx("system", { children: "You are helpful" }),
    jsx("message", { role: "user", children: "hi" }),
  ],
})

if (typeof callLLM !== "function") throw new Error("callLLM export missing")
if (typeof jsx !== "function" || typeof jsxs !== "function") throw new Error("jsx runtime exports missing")
if (typeof jsxDEV !== "function") throw new Error("jsx dev runtime export missing")
if (typeof Fragment !== "function") throw new Error("Fragment export missing")
if (!(new GeminiProvider()).name) throw new Error("provider export missing")
if (tree.type !== "prompt") throw new Error("runtime import did not create prompt")
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

describe("registry smoke", () => {
    if (!registrySpec) {
        test("skips when REGISTRY_SMOKE_SPEC is not set", () => {
            expect(true).toBe(true)
        })
        return
    }

    test(`installs and imports ${registrySpec} from the registry`, { timeout: 60000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), "jsx-ai-registry-smoke-"))

        try {
            writeFileSync(join(dir, "package.json"), JSON.stringify({
                name: "jsx-ai-registry-smoke",
                private: true,
                type: "module",
                dependencies: {
                    "jsx-ai": registrySpec,
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
    })
})
