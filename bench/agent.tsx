// General-purpose coding-agent prompt components used by the benchmark/examples.
import { Skill, UseSkillTool, resolveSkills } from "../src/index";
import type { ExtractedMessage, LLMResponse } from "../src/types";
import { resolve } from "path";

const SKILLS_DIR = resolve(import.meta.dir, "skills");
export const SKILL_PATHS = [
  `${SKILLS_DIR}/agent-core.md`,
  `${SKILLS_DIR}/bun-expert.md`,
  `${SKILLS_DIR}/strict-typescript.md`,
  `${SKILLS_DIR}/security.md`,
  `${SKILLS_DIR}/test-driven.md`,
];

export const SetObjectivesTool = () => (
  <tool
    name="set_objectives"
    description="Define or update the current list of objectives. Call this BEFORE writing code, and again when objectives change."
  >
    <param name="objectives" type="string" required>
      A numbered list of specific, verifiable objectives
    </param>
    <param name="reasoning" type="string" required>
      Why these objectives, and any adjustments from the previous plan
    </param>
  </tool>
);
export const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write content to a file, creating directories as needed"
  >
    <param name="path" type="string" required>
      Path to write the file
    </param>
    <param name="content" type="string" required>
      Full file content to write
    </param>
  </tool>
);
export const ExecTool = () => (
  <tool
    name="exec"
    description="Execute a shell command and return stdout/stderr"
  >
    <param name="command" type="string" required>
      The shell command to run
    </param>
  </tool>
);
export const DoneTool = () => (
  <tool name="done" description="Signal that all objectives are complete">
    <param name="summary" type="string" required>
      Summary of what was accomplished
    </param>
  </tool>
);

export type AgentMessage = ExtractedMessage;

export interface BuildPromptOptions {
  messages: AgentMessage[];
  resolvedSkills?: string[];
  skills?: string[];
}

export function buildPrompt(opts: BuildPromptOptions) {
  const skillPaths = opts.skills || SKILL_PATHS;
  const resolved = resolveSkills(skillPaths, opts.resolvedSkills || []);
  const resolvedPaths = new Set(resolved.map((s) => s.path));
  const hasUnresolvedSkills = resolvedPaths.size < skillPaths.length;

  return (
    <>
      {skillPaths.map((path) => (
        <Skill path={path} resolve={resolvedPaths.has(path)} />
      ))}
      {hasUnresolvedSkills && <UseSkillTool />}
      <SetObjectivesTool />
      <WriteFileTool />
      <ExecTool />
      <DoneTool />
      {opts.messages.map((m) => (
        <message
          role={m.role}
          toolCalls={m.toolCalls}
          toolCallId={m.toolCallId}
          toolName={m.toolName}
          isError={m.isError}
        >
          {m.content}
        </message>
      ))}
    </>
  );
}

/** Canonical assistant history: preserves full tool arguments for every strategy. */
export function resultToAssistantMessage(result: LLMResponse): AgentMessage {
  return {
    role: "assistant",
    content: result.text || "",
    toolCalls: result.toolCalls,
  };
}

/** Simulated tool execution results paired with the original tool-call IDs/names. */
export function resultToToolMessages(result: LLMResponse): AgentMessage[] {
  return result.toolCalls.map((call) => {
    let content: string;
    switch (call.name) {
      case "use_skill":
        content = `Skill activation accepted: ${call.args.skill_name || "unknown"}`;
        break;
      case "set_objectives":
        content = "Objectives accepted.";
        break;
      case "write_file":
        content = `File written successfully: ${call.args.path || "unknown"}`;
        break;
      case "exec":
        content = "Command completed successfully in the benchmark simulation.";
        break;
      case "done":
        content = "Completion signal recorded.";
        break;
      default:
        content = "Tool call completed successfully.";
    }
    return {
      role: "tool" as const,
      content,
      toolCallId: call.id,
      toolName: call.name,
    };
  });
}

/** Human-readable logging helper only; do not use it to construct model history. */
export function summarizeTurn(result: LLMResponse): string {
  const parts = [result.text].filter(Boolean);
  for (const call of result.toolCalls)
    parts.push(`[${call.name}] ${JSON.stringify(call.args)}`);
  return parts.join("\n\n");
}

export function extractRequestedSkills(result: LLMResponse): string[] {
  return result.toolCalls
    .filter((call) => call.name === "use_skill")
    .map((call) => String(call.args.skill_name || "").trim())
    .filter(Boolean);
}
