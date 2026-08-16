// ── Skill Component ──
// Two-phase, lazily resolved methodology files with cached parsing.

import { readFileSync, statSync } from "fs";
import { basename } from "path";
import { jsx } from "./jsx-runtime";
import type { JsxAiNode } from "./types";

export interface SkillMeta {
  name: string;
  description: string;
  content: string;
  path: string;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: SkillMeta;
}

const skillCache = new Map<string, CacheEntry>();

function parseFrontmatterValue(
  frontmatter: string,
  key: string,
): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const keyRegex = new RegExp(
    `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`,
  );
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(keyRegex);
    if (!match) continue;
    const raw = match[1].trim();
    if (!/^[>|][+-]?$/.test(raw)) return raw.replace(/^['"]|['"]$/g, "");

    const block: string[] = [];
    for (i = i + 1; i < lines.length; i++) {
      if (/^[A-Za-z0-9_-]+:\s*/.test(lines[i]) && !/^\s/.test(lines[i])) break;
      block.push(lines[i].replace(/^\s+/, ""));
    }
    const value = raw.startsWith(">") ? block.join(" ") : block.join("\n");
    return value.trim();
  }
  return undefined;
}

/** Parse a skill .md file with small-but-correct YAML frontmatter support. */
export function parseSkillFile(filePath: string): SkillMeta {
  const stat = statSync(filePath);
  const cached = skillCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
    return cached.value;

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const value: SkillMeta = !fmMatch
    ? {
        name: basename(filePath, ".md"),
        description: "",
        content: raw.trim(),
        path: filePath,
      }
    : {
        name:
          parseFrontmatterValue(fmMatch[1], "name") ||
          basename(filePath, ".md"),
        description: parseFrontmatterValue(fmMatch[1], "description") || "",
        content: fmMatch[2].trim(),
        path: filePath,
      };

  skillCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

export function Skill({
  path,
  resolve,
}: {
  path: string;
  resolve?: boolean;
}): JsxAiNode {
  const skill = parseSkillFile(path);
  return resolve
    ? jsx("system", { children: `## Skill: ${skill.name}\n\n${skill.content}` })
    : jsx("system", {
        children: `Available skill: ${skill.name} — ${skill.description}`,
      });
}

export function UseSkillTool(): JsxAiNode {
  return jsx("tool", {
    name: "use_skill",
    description:
      "Activate a skill to get detailed methodology and domain-specific instructions. Call this when you need specialized knowledge for your task.",
    children: jsx("param", {
      name: "skill_name",
      type: "string",
      required: true,
      children: "Exact skill name from the available skills list",
    }),
  });
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/**
 * Resolve exact names first. A shorthand prefix is accepted only when it identifies
 * exactly one skill, preventing silent over-injection from bidirectional substrings.
 */
export function resolveSkills(
  skillPaths: string[],
  requestedNames: string[],
): SkillMeta[] {
  const all = skillPaths.map(parseSkillFile);
  const selected = new Set<string>();

  for (const request of requestedNames) {
    const wanted = normalizeSkillName(String(request || ""));
    if (!wanted) continue;
    const exact = all.find(
      (skill) => normalizeSkillName(skill.name) === wanted,
    );
    if (exact) {
      selected.add(exact.path);
      continue;
    }
    const candidates = all.filter((skill) => {
      const name = normalizeSkillName(skill.name);
      return name.startsWith(`${wanted}-`) || wanted.startsWith(`${name}-`);
    });
    if (candidates.length === 1) selected.add(candidates[0].path);
  }

  return all.filter((skill) => selected.has(skill.path));
}
