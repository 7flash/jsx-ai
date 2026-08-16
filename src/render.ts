// ── Tree Renderer ──
// Walks the JSX virtual tree and extracts the canonical prompt IR.

import type {
  JsxAiNode,
  ParamNode,
  ExtractedPrompt,
  ExtractedTool,
  ExtractedMessage,
} from "./types";

export function extract(node: JsxAiNode): ExtractedPrompt {
  const result: ExtractedPrompt = { tools: [], messages: [] };
  walk(node, result);
  return result;
}

function walk(node: JsxAiNode, result: ExtractedPrompt): void {
  if (!node) return;

  switch (node.type) {
    case "prompt":
      if (node.props.model) result.model = node.props.model;
      if (node.props.provider) result.providerOverride = node.props.provider;
      if (node.props.temperature != null)
        result.temperature = node.props.temperature;
      if (node.props.maxTokens != null) result.maxTokens = node.props.maxTokens;
      if (node.props.strategy) result.strategy = node.props.strategy;
      walkChildren(node.props.children, result);
      break;

    case "tool":
      result.tools.push(extractTool(node));
      break;

    case "message":
      result.messages.push(extractMessage(node));
      break;

    case "system": {
      const text = collectText(node.props.children);
      result.system = result.system ? result.system + "\n\n" + text : text;
      break;
    }

    case "fragment":
      for (const child of node.children) walk(child, result);
      break;

    case "text":
      // Top-level text is ignored: it must be inside message/system.
      break;

    case "param":
      // Params are handled by extractTool.
      break;
  }
}

function walkChildren(
  children: JsxAiNode | JsxAiNode[] | undefined,
  result: ExtractedPrompt,
): void {
  if (!children) return;
  if (Array.isArray(children))
    for (const child of children) walk(child, result);
  else walk(children, result);
}

function extractTool(node: JsxAiNode & { type: "tool" }): ExtractedTool {
  const properties: Record<
    string,
    { type: string; description: string; enum?: string[] }
  > = {};
  const required: string[] = [];
  const paramNodes = collectParamNodes(node.props.children);

  for (const param of paramNodes) {
    const p = param.props;
    const entry: { type: string; description: string; enum?: string[] } = {
      type: p.type || "string",
      description: p.children || "",
    };
    if (p.enum) entry.enum = p.enum;
    properties[p.name] = entry;
    if (p.required) required.push(p.name);
  }

  return {
    name: node.props.name,
    description: node.props.description,
    parameters: { type: "object", properties, required },
  };
}

function extractMessage(
  node: JsxAiNode & { type: "message" },
): ExtractedMessage {
  return {
    role: node.props.role,
    content: collectText(node.props.children),
    ...(node.props.toolCalls?.length
      ? { toolCalls: node.props.toolCalls }
      : {}),
    ...(node.props.toolCallId ? { toolCallId: node.props.toolCallId } : {}),
    ...(node.props.toolName ? { toolName: node.props.toolName } : {}),
    ...(node.props.isError ? { isError: true } : {}),
  };
}

function collectText(
  children: JsxAiNode | JsxAiNode[] | string | undefined,
): string {
  return collectTextRaw(children).trim();
}

function collectTextRaw(
  children: JsxAiNode | JsxAiNode[] | string | undefined,
): string {
  if (!children) return "";
  if (typeof children === "string") return children;
  const nodes = Array.isArray(children) ? children : [children];
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;
        case "fragment":
          return collectTextRaw(node.children);
        case "param":
          return node.props.children ?? "";
        case "tool":
        case "message":
        case "system":
        case "prompt":
          return collectTextRaw(node.props.children);
      }
    })
    .join("");
}

function collectParamNodes(
  children: JsxAiNode | JsxAiNode[] | undefined,
): ParamNode[] {
  if (!children) return [];
  const nodes = Array.isArray(children) ? children : [children];
  const result: ParamNode[] = [];
  for (const child of nodes) {
    if (child.type === "param") result.push(child);
    else if (child.type === "fragment")
      result.push(...collectParamNodes(child.children));
  }
  return result;
}
