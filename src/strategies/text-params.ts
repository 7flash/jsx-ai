import type { JsonObject } from "../types";

interface ParamStart {
  key: string;
  index: number;
  firstLine: string;
}

export interface ParseTextParamsOptions {
  /** Accept legacy `name: value` lines when no explicit PARAM markers exist. */
  allowLegacyBareParams?: boolean;
}

/** Parse multiline textual parameters while respecting the tool's declared parameter names. */
export function parseTextParams(
  body: string,
  declaredNames: readonly string[],
  options: ParseTextParamsOptions = {},
): JsonObject {
  const canonical = new Map(
    declaredNames.map((name) => [name.toLowerCase(), name]),
  );
  const lines = body.replace(/^\s*\n/, "").split("\n");
  const explicit = findStarts(lines, canonical, true);
  const starts =
    explicit.length > 0 || !options.allowLegacyBareParams
      ? explicit
      : findStarts(lines, canonical, false);

  const args: JsonObject = {};
  for (let index = 0; index < starts.length; index++) {
    const current = starts[index];
    const end = starts[index + 1]?.index ?? lines.length;
    args[current.key] = [
      current.firstLine,
      ...lines.slice(current.index + 1, end),
    ]
      .join("\n")
      .trim();
  }
  return args;
}

function findStarts(
  lines: readonly string[],
  canonical: ReadonlyMap<string, string>,
  explicit: boolean,
): ParamStart[] {
  const starts: ParamStart[] = [];
  const pattern = explicit
    ? /^\s*PARAM\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/i
    : /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    const rawKey = match[1];
    const key = canonical.get(rawKey.toLowerCase());
    // Without declared names, explicit PARAM syntax is self-describing.
    if (!key && (canonical.size > 0 || !explicit)) continue;
    starts.push({ key: key ?? rawKey, index, firstLine: match[2] });
  }
  return starts;
}
