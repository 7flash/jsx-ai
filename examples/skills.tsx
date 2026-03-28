// ── jsx-ai example: skill discovery and resolution ──
// Demonstrates the two-phase skill loading flow without calling an LLM.
//
// Usage: bun run examples/skills.tsx

import { render, Skill, UseSkillTool, resolveSkills } from "../src"
import { join } from "path"

const skillPaths = [
    join(import.meta.dir, "skills", "bun-expert.md"),
    join(import.meta.dir, "skills", "security.md"),
]

const discoveryPrompt = (
    <>
        <Skill path={skillPaths[0]} />
        <Skill path={skillPaths[1]} />
        <UseSkillTool />
        <message role="user">Build a small Bun API with safe file handling.</message>
    </>
)

const discovered = render(discoveryPrompt)

console.log("── Discovery phase ──")
console.log("System messages:")
for (const msg of [discovered.system, ...discovered.messages.filter(m => m.role === "system").map(m => m.content)].filter(Boolean)) {
    console.log(String(msg))
}
console.log("Tools:", discovered.tools.map(t => t.name).join(", "))
console.log()

// Simulate the LLM requesting the bun skill via use_skill({ skill_name: "bun-expert" })
const resolved = resolveSkills(skillPaths, ["bun-expert"])

const resolutionPrompt = (
    <>
        {resolved.map(skill => (
            <Skill path={skill.path} resolve />
        ))}
        <message role="user">Now implement the Bun API.</message>
    </>
)

const resolvedPrompt = render(resolutionPrompt)

console.log("── Resolution phase ──")
console.log(resolvedPrompt.system)
console.log()
console.log("Resolved skills:", resolved.map(s => s.name).join(", "))
