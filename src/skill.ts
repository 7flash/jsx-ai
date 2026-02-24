// ── Skill Component ──
//
// Two-phase skill loading for JSX prompts:
//
//   Phase 1 (Discovery):  <Skill path="./skills/bun.md" />
//     → Injects just name + description into the prompt
//     → LLM sees a lightweight catalog of available skills
//
//   Phase 2 (Resolution):  <Skill path="./skills/bun.md" resolve />
//     → Injects full skill content as system instructions
//     → Only activated when the LLM explicitly requests it
//
// Combined with UseSkillTool, this creates a lazy-loading pattern:
//   Turn 1: LLM sees catalog → calls use_skill("bun-expert")
//   Turn 2: Requested skills are resolved → full methodology available

import { readFileSync } from "fs"
import { basename } from "path"
import { jsx } from "./jsx-runtime"
import type { JsxAiNode } from "./types"

export interface SkillMeta {
    name: string
    description: string
    content: string
    path: string
}

/** Parse a skill .md file with YAML frontmatter (name, description) */
export function parseSkillFile(filePath: string): SkillMeta {
    const raw = readFileSync(filePath, "utf-8")
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)

    if (!fmMatch) {
        return {
            name: basename(filePath, ".md"),
            description: "",
            content: raw.trim(),
            path: filePath,
        }
    }

    const fm = fmMatch[1]
    const content = fmMatch[2].trim()
    const name = fm.match(/name:\s*(.+)/)?.[1]?.trim() || basename(filePath, ".md")
    const description = fm.match(/description:\s*(.+)/)?.[1]?.trim() || ""

    return { name, description, content, path: filePath }
}

/**
 * Skill component — lazy-loads methodology from .md files.
 *
 * ```tsx
 * // Discovery mode (default) — lightweight catalog entry
 * <Skill path="./skills/bun-expert.md" />
 *
 * // Resolved mode — full content injected as system instructions
 * <Skill path="./skills/bun-expert.md" resolve />
 * ```
 */
export function Skill({ path, resolve }: { path: string; resolve?: boolean }): JsxAiNode {
    const skill = parseSkillFile(path)

    if (resolve) {
        return jsx("system", { children: `## Skill: ${skill.name}\n\n${skill.content}` })
    }

    // Discovery mode — just name + description for the catalog
    return jsx("system", { children: `Available skill: ${skill.name} — ${skill.description}` })
}

/**
 * Tool that lets the LLM request skill activation.
 *
 * ```tsx
 * <UseSkillTool />
 * // LLM calls: use_skill({ skill_name: "bun-expert" })
 * // Next turn: <Skill path="..." resolve /> is added for the requested skill
 * ```
 */
export function UseSkillTool(): JsxAiNode {
    return jsx("tool", {
        name: "use_skill",
        description: "Activate a skill to get detailed methodology and domain-specific instructions. Call this when you need specialized knowledge for your task.",
        children: jsx("param", {
            name: "skill_name",
            type: "string",
            required: true,
            children: "Name of the skill to activate (from the available skills list)",
        }),
    })
}

/**
 * Resolve which skills to embed based on the LLM's use_skill calls.
 *
 * ```ts
 * const requested = result.toolCalls
 *   .filter(c => c.name === "use_skill")
 *   .map(c => c.args.skill_name)
 *
 * const resolved = resolveSkills(skillPaths, requested)
 * // → SkillMeta[] with full content ready to embed
 * ```
 */
export function resolveSkills(
    skillPaths: string[],
    requestedNames: string[],
): SkillMeta[] {
    const all = skillPaths.map(parseSkillFile)
    return all.filter(s =>
        requestedNames.some(req =>
            s.name.toLowerCase().includes(req.toLowerCase()) ||
            req.toLowerCase().includes(s.name.toLowerCase())
        )
    )
}
