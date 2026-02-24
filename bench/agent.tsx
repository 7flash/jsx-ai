// ── Example Agent ──
//
// A general-purpose coding agent built with jsx-ai.
// This is the pattern smart-agent uses — skills as files,
// tools as JSX components, two-phase skill loading.
//
// Usage:
//   import { buildPrompt, SKILL_PATHS, summarizeTurn } from "./agent"
//
//   const tree = buildPrompt({
//     messages: [{ role: "user", content: "Build a REST API" }],
//   })
//   const result = await callLLM(tree, { model: "gemini-2.5-flash" })

import { Skill, UseSkillTool, resolveSkills, md } from "../src/index"
import type { LLMResponse } from "../src/types"
import { resolve } from "path"

// ── Skills ──

const SKILLS_DIR = resolve(import.meta.dir, "skills")

export const SKILL_PATHS = [
    `${SKILLS_DIR}/agent-core.md`,
    `${SKILLS_DIR}/bun-expert.md`,
    `${SKILLS_DIR}/strict-typescript.md`,
    `${SKILLS_DIR}/security.md`,
    `${SKILLS_DIR}/test-driven.md`,
]


// ── Tools ──

export const SetObjectivesTool = () => (
    <tool name="set_objectives" description="Define or update the current list of objectives. Call this BEFORE writing any code, and again when objectives change.">
        <param name="objectives" type="string" required>
            A numbered list of specific, verifiable objectives
        </param>
        <param name="reasoning" type="string" required>Why these objectives, and any adjustments from previous plan</param>
    </tool>
)

export const WriteFileTool = () => (
    <tool name="write_file" description="Write content to a file, creating directories as needed">
        <param name="path" type="string" required>Path to write the file</param>
        <param name="content" type="string" required>Full file content to write</param>
    </tool>
)

export const ExecTool = () => (
    <tool name="exec" description="Execute a shell command and return stdout/stderr">
        <param name="command" type="string" required>The shell command to run</param>
    </tool>
)

export const DoneTool = () => (
    <tool name="done" description="Signal that all objectives are complete">
        <param name="summary" type="string" required>Summary of what was accomplished</param>
    </tool>
)


// ── Prompt Builder ──

export interface AgentMessage {
    role: "user" | "assistant"
    content: string
}

export interface BuildPromptOptions {
    /** Conversation messages — at minimum one user message */
    messages: AgentMessage[]
    /** Skill names to fully resolve (from previous use_skill calls) */
    resolvedSkills?: string[]
    /** Skill file paths (defaults to SKILL_PATHS) */
    skills?: string[]
}

/**
 * Build a prompt tree for any turn of the agent loop.
 *
 * The two-phase skill pattern is automatic:
 * - Skills listed in resolvedSkills get full methodology content
 * - All other skills show as lightweight catalog entries (name + description)
 * - UseSkillTool is included when no skills are resolved yet
 *
 * ```tsx
 * // Turn 1: discovery — all skills as catalog
 * buildPrompt({ messages: [{ role: "user", content: task }] })
 *
 * // Turn 2: execution — requested skills resolved
 * buildPrompt({
 *   messages: [...history],
 *   resolvedSkills: ["bun-expert", "strict-typescript"],
 * })
 * ```
 */
export function buildPrompt(opts: BuildPromptOptions) {
    const skillPaths = opts.skills || SKILL_PATHS
    const resolved = opts.resolvedSkills
        ? resolveSkills(skillPaths, opts.resolvedSkills)
        : []
    const resolvedPaths = new Set(resolved.map(s => s.path))
    const hasResolvedSkills = resolved.length > 0

    return <>
        {/* Two-phase skills: resolved get full content, others stay as catalog */}
        {skillPaths.map(p =>
            <Skill path={p} resolve={resolvedPaths.has(p)} />
        )}

        {/* Tools — UseSkillTool only when still discovering */}
        {!hasResolvedSkills && <UseSkillTool />}
        <SetObjectivesTool />
        <WriteFileTool />
        <ExecTool />
        <DoneTool />

        {/* Conversation */}
        {opts.messages.map(m =>
            <message role={m.role}>{m.content}</message>
        )}
    </>
}


// ── Turn Utilities ──

/** Summarize a turn's output for conversation history */
export function summarizeTurn(result: LLMResponse): string {
    const parts: string[] = []
    if (result.text) parts.push(result.text)
    for (const tc of result.toolCalls) {
        switch (tc.name) {
            case "set_objectives":
                parts.push(`[Called set_objectives]\n${tc.args.objectives || ""}`)
                break
            case "use_skill":
                parts.push(`[Called use_skill: ${tc.args.skill_name}]`)
                break
            case "write_file": {
                const preview = (tc.args.content || "").substring(0, 200)
                parts.push(`[Called write_file: ${tc.args.path}]\n${preview}...`)
                break
            }
            case "exec":
                parts.push(`[Called exec: ${tc.args.command}]`)
                break
            case "done":
                parts.push(`[Called done: ${tc.args.summary}]`)
                break
            default:
                parts.push(`[Called ${tc.name}(${JSON.stringify(tc.args).substring(0, 200)})]`)
        }
    }
    return parts.join("\n\n")
}

/** Extract skill names requested via use_skill tool calls */
export function extractRequestedSkills(result: LLMResponse): string[] {
    return result.toolCalls
        .filter(c => c.name === "use_skill")
        .map(c => c.args.skill_name as string)
}
