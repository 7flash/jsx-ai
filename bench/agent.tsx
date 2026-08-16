// Shared coding-agent prompt components for end-to-end benchmarks.
import { Skill, UseSkillTool, resolveSkills, md } from "../src/index";
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
    description="Define or update the current implementation objectives."
  >
    <param name="objectives" type="string" required>
      A numbered list of concrete, verifiable objectives
    </param>
    <param name="reasoning" type="string" required>
      Why these objectives are appropriate
    </param>
  </tool>
);

export const ReadFileTool = () => (
  <tool
    name="read_file"
    description="Read a UTF-8 text file from the isolated project workspace"
  >
    <param name="path" type="string" required>
      Relative path inside the project workspace
    </param>
  </tool>
);

export const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write a UTF-8 text file inside the isolated project workspace, creating directories as needed"
  >
    <param name="path" type="string" required>
      Relative path inside the project workspace
    </param>
    <param name="content" type="string" required>
      Complete file contents
    </param>
  </tool>
);

export const ExecTool = () => (
  <tool
    name="exec"
    description="Run a safe diagnostic command in the isolated workspace. Supported commands include bun test, bun x tsc --noEmit, ls, find, cat, and pwd."
  >
    <param name="command" type="string" required>
      Diagnostic command to run
    </param>
  </tool>
);

export const DoneTool = () => (
  <tool
    name="done"
    description="Signal that implementation and verification are complete"
  >
    <param name="summary" type="string" required>
      Concise summary of what was completed and verified
    </param>
  </tool>
);

export type AgentMessage = ExtractedMessage;

export interface BuildPromptOptions {
  messages: readonly AgentMessage[];
  resolvedSkills?: string[];
  skills?: string[];
}

export function buildPrompt(opts: BuildPromptOptions) {
  const skillPaths = opts.skills || SKILL_PATHS;
  const resolved = resolveSkills(skillPaths, opts.resolvedSkills || []);
  const resolvedPaths = new Set(resolved.map((skill) => skill.path));
  const hasUnresolvedSkills = resolvedPaths.size < skillPaths.length;

  return (
    <>
      <system>{md`
        You are an autonomous coding agent operating in an isolated workspace.
        Use tools to inspect, implement, test, and repair the project until the user's contract is satisfied.
        Prefer evidence from tests/diagnostics over assumptions. You may call multiple independent tools in one turn.
        Call done only after the implementation is ready for an independent hidden evaluator.
      `}</system>
      {skillPaths.map((path) => (
        <Skill path={path} resolve={resolvedPaths.has(path)} />
      ))}
      {hasUnresolvedSkills && <UseSkillTool />}
      <SetObjectivesTool />
      <ReadFileTool />
      <WriteFileTool />
      <ExecTool />
      <DoneTool />
      {opts.messages.map((message) => (
        <message
          role={message.role}
          toolCalls={message.toolCalls}
          toolCallId={message.toolCallId}
          toolName={message.toolName}
          isError={message.isError}
        >
          {message.content}
        </message>
      ))}
    </>
  );
}

/** Logging helper. Canonical history should use the structured messages directly. */
export function summarizeTurn(result: LLMResponse): string {
  const parts = [result.text].filter(Boolean);
  for (const call of result.toolCalls)
    parts.push(`[${call.name}] ${JSON.stringify(call.args)}`);
  return parts.join("\n\n");
}
