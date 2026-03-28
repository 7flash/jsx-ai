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

type RegistryMetadata = {
    "dist-tags"?: Record<string, string>
    versions?: Record<string, unknown>
}

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

function parseRegistrySpec(spec: string): { packageName: string; requestedVersion?: string } {
    const atIndex = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@")
    if (atIndex === -1) return { packageName: spec }
    return {
        packageName: spec.slice(0, atIndex),
        requestedVersion: spec.slice(atIndex + 1),
    }
}

async function fetchRegistryMetadata(packageName: string): Promise<RegistryMetadata> {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`)
    if (!response.ok) {
        throw new Error(`Unable to fetch npm metadata for ${packageName} (HTTP ${response.status}). This usually means the package is not published or the registry is temporarily unavailable.`)
    }
    return await response.json() as RegistryMetadata
}

async function assertRegistrySpecResolvable(spec: string): Promise<void> {
    const { packageName, requestedVersion } = parseRegistrySpec(spec)
    const metadata = await fetchRegistryMetadata(packageName)
    const distTags = metadata["dist-tags"] || {}
    const versions = Object.keys(metadata.versions || {})
    const recentVersions = versions.slice(-5)

    if (!requestedVersion) return

    if (requestedVersion in distTags) return
    if (versions.includes(requestedVersion)) return

    throw new Error(
        `Registry package spec ${spec} is not available yet. ` +
        `Known dist-tags: ${Object.entries(distTags).map(([tag, version]) => `${tag}=${version}`).join(", ") || "none"}. ` +
        `Recent published versions: ${recentVersions.join(", ") || "none"}. ` +
        `If this is a fresh release, publication may still be propagating — retry the registry smoke workflow in a minute.`
    )
}

describe("registry smoke", () => {
    if (!registrySpec) {
        test("skips when REGISTRY_SMOKE_SPEC is not set", () => {
            expect(true).toBe(true)
        })
        return
    }

    test(`installs and imports ${registrySpec} from the registry`, { timeout: 60000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "jsx-ai-registry-smoke-"))

        try {
            await assertRegistrySpecResolvable(registrySpec)

            writeFileSync(join(dir, "package.json"), JSON.stringify({
                name: "jsx-ai-registry-smoke",
                private: true,
                type: "module",
                dependencies: {
                    "jsx-ai": registrySpec,
                },
            }, null, 2))

            writeFileSync(join(dir, "smoke.tsx"), smokeSource)

            expectSuccess(run(["bun", "install"], dir), `bun install for ${registrySpec}`)
            const smokeRun = run(["bun", "run", "--install=fallback", "smoke.tsx"], dir)
            expectSuccess(smokeRun, `bun run smoke.tsx for ${registrySpec}`)
            expect(smokeRun.stdout.toString()).toContain("ok")
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
