import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("package consumer smoke", () => {
    test("clean consumer project can import published-style entrypoints", { timeout: 30000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), "jsx-ai-consumer-"))

        try {
            writeFileSync(join(dir, "package.json"), JSON.stringify({
                name: "jsx-ai-consumer-smoke",
                private: true,
                type: "module",
                dependencies: {
                    "jsx-ai": `file:${join(import.meta.dir, "..").replace(/\\/g, "/")}`,
                },
            }, null, 2))

            writeFileSync(join(dir, "smoke.tsx"), `
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
`)

            const install = Bun.spawnSync(["bun", "install"], {
                cwd: dir,
                stdout: "pipe",
                stderr: "pipe",
                env: process.env,
            })
            expect(install.exitCode).toBe(0)

            const run = Bun.spawnSync(["bun", "run", "--install=fallback", "smoke.tsx"], {
                cwd: dir,
                stdout: "pipe",
                stderr: "pipe",
                env: process.env,
            })
            expect(run.exitCode).toBe(0)
            expect(run.stdout.toString()).toContain("ok")
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
