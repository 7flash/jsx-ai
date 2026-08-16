import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseSkillFile, resolveSkills } from "./skill";

test("folded skill descriptions parse and shorthand does not over-resolve", () => {
  const dir = mkdtempSync(join(tmpdir(), "jsx-ai-skill-"));
  const bun = join(dir, "bun-expert.md");
  const bunBasic = join(dir, "bun.md");
  writeFileSync(
    bun,
    `---\nname: bun-expert\ndescription: >-\n  Expert Bun runtime\n  and SQLite guidance\n---\nBody\n`,
  );
  writeFileSync(bunBasic, `---\nname: bun\ndescription: Basic\n---\nBody\n`);

  expect(parseSkillFile(bun).description).toBe(
    "Expert Bun runtime and SQLite guidance",
  );
  expect(resolveSkills([bun, bunBasic], ["bun"]).map((s) => s.name)).toEqual([
    "bun",
  ]);
  expect(resolveSkills([bun], ["bun"]).map((s) => s.name)).toEqual([
    "bun-expert",
  ]);
});
