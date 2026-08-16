// ── jsx-ai example: skills-based coding agent ──
// Demonstrates the two-phase Skill pattern:
//   1) Discovery turn: model sees a lightweight skill catalog and can call use_skill
//   2) Resolution turn: requested skills are expanded to full methodology
//
// Usage:
//   bun run examples/skills-agent.tsx
//   bun run examples/skills-agent.tsx "Build a tiny Bun HTTP JSON API with tests"

import {
  callLLM,
  render,
  Skill,
  UseSkillTool,
  resolveSkills,
  md,
} from "../src";
import { resolve } from "path";

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
  const resolvedPaths = new Set(resolved.map((s) => s.path));
  const hasResolvedSkills = resolved.length > 0;

  return (
    <prompt model="gemini-2.5-flash" strategy="hybrid" temperature={0.1}>
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

      {messages.map((m) => (
        <message role={m.role}>{m.content}</message>
      ))}
    </prompt>
  );
}

function summarizeToolCalls(
  toolCalls: Array<{ name: string; args: Record<string, any> }>,
) {
  if (toolCalls.length === 0) return "(none)";
  return toolCalls
    .map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)})`)
    .join("\n");
}

function requestedSkillsFrom(
  result: Awaited<ReturnType<typeof callLLM>>,
): string[] {
  return result.toolCalls
    .filter((tc) => tc.name === "use_skill")
    .map((tc) => String(tc.args.skill_name || "").trim())
    .filter(Boolean);
}

const userRequest =
  process.argv[2] || "Build a tiny Bun HTTP JSON API with tests";

console.log("── Skills agent demo ──");
console.log(`User request: ${userRequest}`);
console.log();

// Turn 1: discovery
const turn1Prompt = buildPrompt([{ role: "user", content: userRequest }]);

const turn1Extracted = render(turn1Prompt);
console.log("Turn 1 (discovery)");
console.log(`- system blocks: skill catalog + agent instructions`);
console.log(`- tools: ${turn1Extracted.tools.map((t) => t.name).join(", ")}`);
console.log(`- messages: ${turn1Extracted.messages.length}`);
console.log();

const turn1 = await callLLM(turn1Prompt);
console.log("Turn 1 result");
if (turn1.text) console.log(`Text:\n${turn1.text}\n`);
console.log(`Tool calls:\n${summarizeToolCalls(turn1.toolCalls)}`);
if (turn1.usage)
  console.log(
    `Tokens: ${turn1.usage.inputTokens} in → ${turn1.usage.outputTokens} out`,
  );
console.log();

const requestedSkills = requestedSkillsFrom(turn1);
if (requestedSkills.length === 0) {
  console.log("No skills were requested, so the demo stops after discovery.");
  process.exit(0);
}

console.log(`Requested skills: ${requestedSkills.join(", ")}`);
console.log();

// Turn 2: resolution
const resolved = resolveSkills(SKILL_PATHS, requestedSkills);
const turn2Prompt = buildPrompt(
  [
    { role: "user", content: userRequest },
    {
      role: "assistant",
      content: md`
            Previous turn summary:
            ${turn1.text || "(no assistant text)"}

            Tool calls:
            ${summarizeToolCalls(turn1.toolCalls)}
        `,
    },
    {
      role: "user",
      content:
        "Continue with the requested skills now resolved. Propose the first concrete implementation actions.",
    },
  ],
  requestedSkills,
);

const turn2Extracted = render(turn2Prompt);
console.log("Turn 2 (resolved)");
console.log(
  `- resolved skills embedded: ${resolved.map((s) => s.name).join(", ")}`,
);
console.log(`- tools: ${turn2Extracted.tools.map((t) => t.name).join(", ")}`);
console.log(`- messages: ${turn2Extracted.messages.length}`);
console.log();

const turn2 = await callLLM(turn2Prompt);
console.log("Turn 2 result");
if (turn2.text) console.log(`Text:\n${turn2.text}\n`);
console.log(`Tool calls:\n${summarizeToolCalls(turn2.toolCalls)}`);
if (turn2.usage)
  console.log(
    `Tokens: ${turn2.usage.inputTokens} in → ${turn2.usage.outputTokens} out`,
  );
