import { schemaTypeLabel } from "../ir";
import type {
  ExtractedMessage,
  ExtractedPrompt,
  JsonObject,
  RenderStrategy,
  ToolCall,
} from "../types";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function messageXml(message: ExtractedMessage): string {
  const attrs = [
    `role="${escapeXml(message.role)}"`,
    message.toolCallId ? `tool_call_id="${escapeXml(message.toolCallId)}"` : "",
    message.toolName ? `tool_name="${escapeXml(message.toolName)}"` : "",
    message.isError ? `is_error="true"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const parts = [escapeXml(message.content)];
  for (const call of message.toolCalls || []) {
    const id = call.id ? ` id="${escapeXml(call.id)}"` : "";
    parts.push(
      `<tool_call name="${escapeXml(call.name)}"${id}><args>${escapeXml(JSON.stringify(call.args))}</args></tool_call>`,
    );
  }
  return `    <message ${attrs}>${parts.join("")}</message>`;
}

export function buildXMLDocument(prompt: ExtractedPrompt): string {
  const parts: string[] = ["<prompt>"];
  if (prompt.system)
    parts.push(`  <system>${escapeXml(prompt.system)}</system>`);

  if (prompt.tools.length) {
    parts.push("  <tools>");
    for (const tool of prompt.tools) {
      parts.push(
        `    <tool name="${escapeXml(tool.name)}" description="${escapeXml(tool.description)}">`,
      );
      for (const [name, p] of Object.entries(tool.parameters.properties)) {
        const required = tool.parameters.required.includes(name)
          ? ` required="true"`
          : "";
        const enumAttr = p.enum?.length
          ? ` enum="${escapeXml(p.enum.map((value) => JSON.stringify(value)).join(","))}"`
          : "";
        parts.push(
          `      <param name="${escapeXml(name)}" type="${escapeXml(schemaTypeLabel(p))}"${required}${enumAttr}>${escapeXml(p.description ?? "")}</param>`,
        );
      }
      parts.push("    </tool>");
    }
    parts.push("  </tools>");
  }

  if (prompt.messages.length) {
    parts.push("  <messages>");
    for (const message of prompt.messages) parts.push(messageXml(message));
    parts.push("  </messages>");
  }

  parts.push(
    "  <response_format>",
    "    Respond only with a response XML document. Put arbitrary parameter text inside CDATA:",
    "    <response>",
    "      <message>Concise explanation</message>",
    "      <tool_calls>",
    '        <call tool="tool_name"><param name="param_name"><![CDATA[value]]></param></call>',
    "      </tool_calls>",
    "    </response>",
    "  </response_format>",
    "</prompt>",
  );
  return parts.join("\n");
}

function decodeParam(
  cdataValue: string | undefined,
  escapedValue: string | undefined,
): string {
  if (cdataValue !== undefined) return cdataValue;
  return unescapeXml((escapedValue ?? "").trim());
}

export function parseXMLToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const callRegex =
    /<call\s+tool="([^"]+)"(?:\s+id="([^"]+)")?\s*>([\s\S]*?)<\/call>/gi;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(text)) !== null) {
    const args: JsonObject = {};
    // Prefer a CDATA branch that must close before </param>; this prevents literal
    // </param> text inside CDATA from prematurely terminating the parameter.
    const paramRegex =
      /<param\s+name="([^"]+)"\s*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/param>/gi;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(match[3])) !== null) {
      args[unescapeXml(paramMatch[1])] = decodeParam(
        paramMatch[2],
        paramMatch[3],
      );
    }
    calls.push({
      ...(match[2] ? { id: unescapeXml(match[2]) } : {}),
      name: unescapeXml(match[1]),
      args,
    });
  }
  return calls;
}

export const xml: RenderStrategy = {
  name: "xml",
  prepare(prompt) {
    return {
      messages: [{ role: "user", content: buildXMLDocument(prompt) }],
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };
  },
  parseResponse(response) {
    const match = response.text.match(/<message>([\s\S]*?)<\/message>/i);
    const message = match
      ? unescapeXml(match[1].replace(/<[^>]+>/g, "").trim())
      : unescapeXml(response.text.replace(/<[^>]+>/g, "").trim());
    return { text: message, toolCalls: parseXMLToolCalls(response.text) };
  },
};
