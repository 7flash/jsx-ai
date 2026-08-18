import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { JSX_AI_VERSION } from "./version"

describe("package version", () => {
    test("runtime diagnostics stay in sync with package.json", () => {
        const packageJson = JSON.parse(
            readFileSync(new URL("../package.json", import.meta.url), "utf8"),
        ) as { version?: unknown }
        expect(JSX_AI_VERSION).toBe(packageJson.version)
    })
})
