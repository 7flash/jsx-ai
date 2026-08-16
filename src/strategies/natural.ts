import type { ExtractedPrompt, RenderStrategy, ToolCall } from "../types";
import { textProtocolMessages } from "../message";
import { parseTextParams } from "./text-params";

function toolsToNaturalLanguage(tools: ExtractedPrompt["tools"]): string {
  if (tools.length === 0) return "";
  const toolDescriptions = tools
    .map((t) => {
      const params = Object.entries(t.parameters.properties)
        .map(
          ([name, p]) =>
            `  - ${name}${t.parameters.required.includes(name) ? "" : " (optional)"}: ${p.description}`,
        )
        .join("\n");
      return `• ${t.name} — ${t.description}\n  Parameters:\n${params}`;
    })
    .join("\n\n");

  return (
    `You have the following tools available:\n\n${toolDescriptions}\n\n` +
    `When using a tool, emit one or more blocks exactly like this:\n\n` +
    `TOOL_CALL: tool_name\nPARAM key1: value1\nPARAM key2: value2\nEND_CALL\n\n` +
    `Multiline values continue until the next declared PARAM line or END_CALL. ` +
    `You may include a concise explanation before the first TOOL_CALL.`
  );
}

export function parseNaturalToolCalls(
  text: string,
  prompt?: ExtractedPrompt,
): ToolCall[] {
  const calls: ToolCall[] = [];
  const toolNames = new Set(prompt?.tools.map((t) => t.name) || []);
  const callRegex =
    /^\s*TOOL_CALL:\s*([A-Za-z0-9_.-]+)\s*\n([\s\S]*?)^\s*END_CALL\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(text)) !== null) {
    const name = match[1].trim();
    if (toolNames.size && !toolNames.has(name)) continue;
    const tool = prompt?.tools.find((candidate) => candidate.name === name);
    const args = parseTextParams(
      match[2],
      Object.keys(tool?.parameters.properties ?? {}),
    );
    calls.push({ id: `natural_${calls.length}_${name}`, name, args });
  }
  return calls;
}

export const natural: RenderStrategy = {
  name: "natural",
  prepare(prompt) {
    const systemParts = [
      prompt.system,
      toolsToNaturalLanguage(prompt.tools),
    ].filter(Boolean);
    return {
      system: systemParts.join("\n\n"),
      messages: textProtocolMessages(prompt.messages),
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };
  },
  parseResponse(response, prompt) {
    const text = response.text;
    const explanation = text
      .split(/^\s*TOOL_CALL:/im)[0]
      .replace(/^\s*THINKING:\s*/i, "")
      .trim();
    return {
      text: explanation,
      toolCalls: parseNaturalToolCalls(text, prompt),
    };
  },
};
