// @jsxImportSource jsx-ai
// jsx-ai example: two-phase skill discovery/resolution with measured model calls.

import { resolve } from "path";
import {
  callLLM,
  render,
  Skill,
  UseSkillTool,
  resolveSkills,
  md,
} from "../src";
import type { ToolCall } from "../src";
import {
  measure,
  printResponseDetails,
  summarizeResponse,
} from "./_example-observability";

const SKILLS_DIR = resolve(import.meta.dir, "../bench/skills");
const SKILL_PATHS = [
  resolve(SKILLS_DIR, "agent-core.md"),
  resolve(SKILLS_DIR, "bun-expert.md"),
  resolve(SKILLS_DIR, "strict-typescript.md"),
  resolve(SKILLS_DIR, "security.md"),
  resolve(SKILLS_DIR, "test-driven.md"),
];

const SetObjectivesTool = () => (
  <tool
    name="set_objectives"
    description="Define or update a numbered list of implementation objectives before coding."
  >
    <param name="objectives" type="string" required>
      A numbered list of concrete objectives
    </param>
    <param name="reasoning" type="string" required>
      Why these objectives were chosen
    </param>
  </tool>
);

const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write a file, creating directories if needed"
  >
    <param name="path" type="string" required>
      File path to write
    </param>
    <param name="content" type="string" required>
      Full file contents
    </param>
  </tool>
);

const ExecTool = () => (
  <tool
    name="exec"
    description="Execute a shell command and return stdout/stderr"
  >
    <param name="command" type="string" required>
      The command to run
    </param>
  </tool>
);

const DoneTool = () => (
  <tool name="done" description="Signal that the plan is complete">
    <param name="summary" type="string" required>
      Summary of what was completed
    </param>
  </tool>
);

function buildPrompt(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  resolvedSkillNames: string[] = [],
) {
  const resolved = resolveSkills(SKILL_PATHS, resolvedSkillNames);
  const resolvedPaths = new Set(resolved.map((skill) => skill.path));
  const hasResolvedSkills = resolved.length > 0;

  return (
    <prompt strategy="hybrid">
      <system>{md`
        You are a coding agent that can plan work, activate skills when needed,
        and then propose concrete file edits and commands.

        On the first turn, inspect the available skills catalog and call use_skill
        if specialized methodology would help.

        Before proposing file changes, call set_objectives with a short numbered plan.
      `}</system>

      {SKILL_PATHS.map((path) => (
        <Skill path={path} resolve={resolvedPaths.has(path)} />
      ))}
      {!hasResolvedSkills && <UseSkillTool />}
      <SetObjectivesTool />
      <WriteFileTool />
      <ExecTool />
      <DoneTool />

      {messages.map((message) => (
        <message role={message.role}>{message.content}</message>
      ))}
    </prompt>
  );
}

function requestedSkillsFrom(toolCalls: readonly ToolCall[]): string[] {
  return toolCalls
    .filter((call) => call.name === "use_skill")
    .map((call) => String(call.args.skill_name || "").trim())
    .filter(Boolean);
}

const userRequest =
  process.argv[2] || "Build a tiny Bun HTTP JSON API with tests";
console.log(
  `jsx-ai skills example\nruntime/model: resolved by jsx-ai\nrequest: ${userRequest}\n`,
);

const turn1Prompt = buildPrompt([{ role: "user", content: userRequest }]);
const turn1IR = render(turn1Prompt);
console.log(
  `Discovery prompt: ${turn1IR.tools.length} tools, ${turn1IR.messages.length} message(s), ${SKILL_PATHS.length} skill catalog entries`,
);

const turn1 = await measure.assert(
  {
    label: "Turn 1 — skill discovery",
    tools: turn1IR.tools.length,
    result: summarizeResponse,
  },
  () => callLLM(turn1Prompt),
);
printResponseDetails(turn1);

const requestedSkills = requestedSkillsFrom(turn1.toolCalls);
if (!requestedSkills.length) {
  console.log("\nNo skills were requested; discovery is complete.");
  process.exit(0);
}

const resolved = resolveSkills(SKILL_PATHS, requestedSkills);
console.log(
  `\nResolved skills: ${resolved.map((skill) => skill.name).join(", ")}`,
);

const turn2Prompt = buildPrompt(
  [
    { role: "user", content: userRequest },
    {
      role: "assistant",
      content: md`
            Previous turn requested these skills: ${requestedSkills.join(", ")}.
            Continue using the resolved methodology.
        `,
    },
    {
      role: "user",
      content: "Propose the first concrete implementation actions.",
    },
  ],
  requestedSkills,
);
const turn2IR = render(turn2Prompt);

const turn2 = await measure.assert(
  {
    label: "Turn 2 — resolved skills",
    resolvedSkills: resolved.map((skill) => skill.name).join(","),
    tools: turn2IR.tools.length,
    result: summarizeResponse,
  },
  () => callLLM(turn2Prompt),
);
printResponseDetails(turn2);
