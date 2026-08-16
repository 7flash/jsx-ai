// NLT-style exhaustive tool assessment, extended with explicit PARAM markers.
import type { ExtractedPrompt, RenderStrategy, ToolCall } from "../types";
import { textProtocolMessages } from "../message";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNLTSystemPrompt(prompt: ExtractedPrompt): string {
  const parts: string[] = [];
  if (prompt.system) parts.push(prompt.system);
  parts.push(
    "Determine which tools are needed for the task and provide arguments for every selected tool.",
  );

  if (prompt.tools.length) {
    parts.push(
      "Available tools:\n\n" +
        prompt.tools
          .map((t) => {
            const params = Object.entries(t.parameters.properties)
              .map(
                ([name, p]) =>
                  `    ${name}${t.parameters.required.includes(name) ? " (required)" : " (optional)"}: ${p.description}`,
              )
              .join("\n");
            return `${t.name}: ${t.description}\n  Parameters:\n${params}`;
          })
          .join("\n\n"),
    );
  }

  parts.push(
    "Begin with a concise assessment. Then list EVERY available tool with YES or NO. " +
      "For each YES invocation, write every argument as `PARAM paramName: value`. " +
      "Multiline values continue until the next declared PARAM line or the next tool decision. " +
      "Repeat a YES block when the same tool must be called more than once. End with `Assessment finished.`",
  );

  if (prompt.tools.length) {
    const example = ["Format:", "Thinking: (brief selection reasoning)", ""];
    for (const tool of prompt.tools) {
      example.push(`${tool.name} – YES/NO`);
      for (const p of Object.keys(tool.parameters.properties))
        example.push(`PARAM ${p}: (value, only if YES)`);
      example.push("");
    }
    example.push("Assessment finished.");
    parts.push(example.join("\n"));
  }
  return parts.join("\n\n");
}

interface DecisionMarker {
  name: string;
  yes: boolean;
  start: number;
  bodyStart: number;
}

function findDecisionMarkers(
  text: string,
  prompt?: ExtractedPrompt,
): DecisionMarker[] {
  const names = prompt?.tools.map((t) => t.name) || [];
  const namePattern = names.length
    ? names
        .map(escapeRegex)
        .sort((a, b) => b.length - a.length)
        .join("|")
    : "[A-Za-z0-9_.-]+";
  const regex = new RegExp(
    `^\\s*(?:[-*+]\\s+)?(${namePattern})\\s*[–—:-]\\s*(YES|NO)\\b[^\\n]*`,
    "gim",
  );
  const canonical = new Map(names.map((n) => [n.toLowerCase(), n]));
  const markers: DecisionMarker[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    markers.push({
      name: canonical.get(raw.toLowerCase()) || raw,
      yes: match[2].toLowerCase() === "yes",
      start: match.index,
      bodyStart: regex.lastIndex,
    });
  }
  return markers;
}

function parseParams(
  body: string,
  prompt: ExtractedPrompt | undefined,
  toolName: string,
): Record<string, any> {
  const tool = prompt?.tools.find(
    (t) => t.name.toLowerCase() === toolName.toLowerCase(),
  );
  const declared = Object.keys(tool?.parameters.properties || {});
  const canonical = new Map(declared.map((n) => [n.toLowerCase(), n]));
  const lines = body.replace(/^\s*\n/, "").split("\n");

  const explicit: Array<{ key: string; index: number; first: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^\s*PARAM\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/i,
    );
    if (!match) continue;
    const key =
      canonical.get(match[1].toLowerCase()) ||
      (!declared.length ? match[1] : undefined);
    if (key) explicit.push({ key, index: i, first: match[2] });
  }

  // Backward compatibility for old NLT output. Only use legacy `name:` parsing when
  // no explicit PARAM marker exists, and only for declared parameter names.
  const starts = explicit.length
    ? explicit
    : lines.flatMap((line, index) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (!match) return [];
        const key = canonical.get(match[1].toLowerCase());
        return key ? [{ key, index, first: match[2] }] : [];
      });

  const args: Record<string, any> = {};
  for (let i = 0; i < starts.length; i++) {
    const current = starts[i];
    const end = starts[i + 1]?.index ?? lines.length;
    args[current.key] = [current.first, ...lines.slice(current.index + 1, end)]
      .join("\n")
      .trim();
  }
  return args;
}

export function parseNLTToolCalls(
  text: string,
  prompt?: ExtractedPrompt,
): ToolCall[] {
  const markers = findDecisionMarkers(text, prompt);
  const assessment = /^\s*Assessment\s+finished\.?\s*$/gim.exec(text);
  const assessmentStart = assessment?.index ?? text.length;
  const calls: ToolCall[] = [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!marker.yes) continue;
    const next = markers[i + 1]?.start ?? assessmentStart;
    const body = text.slice(marker.bodyStart, Math.max(marker.bodyStart, next));
    calls.push({
      id: `nlt_${calls.length}_${marker.name}`,
      name: marker.name,
      args: parseParams(body, prompt, marker.name),
    });
  }
  return calls;
}

export const nlt: RenderStrategy = {
  name: "nlt",
  prepare(prompt) {
    return {
      system: buildNLTSystemPrompt(prompt),
      messages: textProtocolMessages(prompt.messages),
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };
  },
  parseResponse(response, prompt) {
    return {
      text: response.text,
      toolCalls: parseNLTToolCalls(response.text, prompt),
    };
  },
};
