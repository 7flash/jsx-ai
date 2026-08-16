// ── Tree Renderer ──
// Walks the JSX virtual tree, then normalizes it through the canonical IR boundary.

import {
  normalizeJsonSchema,
  normalizePromptIR,
  normalizeToolParametersSchema,
  type PromptMessageInput,
} from "./ir";
import type {
  ExtractedPrompt,
  ExtractedTool,
  JsonSchema,
  JsxAiNode,
  ParamNode,
} from "./types";

interface PromptDraft {
  tools: ExtractedTool[];
  messages: PromptMessageInput[];
  system?: string;
  model?: string;
  providerOverride?: ExtractedPrompt["providerOverride"];
  temperature?: number;
  maxTokens?: number;
  strategy?: ExtractedPrompt["strategy"];
}

export function extract(node: JsxAiNode): ExtractedPrompt {
  const result: PromptDraft = { tools: [], messages: [] };
  walk(node, result);
  return normalizePromptIR(result);
}

function walk(node: JsxAiNode, result: PromptDraft): void {
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
      result.system = result.system ? `${result.system}\n\n${text}` : text;
      break;
    }

    case "fragment":
      for (const child of node.children) walk(child, result);
      break;

    case "text":
      // Top-level text is intentionally ignored: it must be inside message/system.
      break;

    case "param":
      // Params are meaningful only inside <tool> and are consumed by extractTool.
      break;
  }
}

function walkChildren(
  children: JsxAiNode | JsxAiNode[] | undefined,
  result: PromptDraft,
): void {
  if (!children) return;
  if (Array.isArray(children))
    for (const child of children) walk(child, result);
  else walk(children, result);
}

function parameterSchema(param: ParamNode, context: string): JsonSchema {
  const description = param.props.children?.trim();
  if (param.props.schema) {
    const schema = normalizeJsonSchema(param.props.schema, `${context}.schema`);
    return description && !schema.description
      ? normalizeJsonSchema({ ...schema, description }, `${context}.schema`)
      : schema;
  }

  return normalizeJsonSchema(
    {
      type: param.props.type ?? "string",
      ...(description ? { description } : {}),
      ...(param.props.enum?.length ? { enum: param.props.enum } : {}),
    },
    context,
  );
}

function extractTool(node: JsxAiNode & { type: "tool" }): ExtractedTool {
  const paramNodes = collectParamNodes(node.props.children);
  if (node.props.schema && paramNodes.length) {
    throw new TypeError(
      `<tool name=${JSON.stringify(node.props.name)}> cannot combine schema with <param> children`,
    );
  }

  if (node.props.schema) {
    return {
      name: node.props.name,
      description: node.props.description,
      parameters: normalizeToolParametersSchema(
        node.props.schema,
        `tool ${JSON.stringify(node.props.name)} schema`,
      ),
    };
  }

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (let index = 0; index < paramNodes.length; index++) {
    const param = paramNodes[index];
    if (Object.hasOwn(properties, param.props.name)) {
      throw new TypeError(
        `<tool name=${JSON.stringify(node.props.name)}> contains duplicate param ${JSON.stringify(param.props.name)}`,
      );
    }
    properties[param.props.name] = parameterSchema(
      param,
      `tool ${JSON.stringify(node.props.name)} param ${JSON.stringify(param.props.name)}`,
    );
    if (param.props.required) required.push(param.props.name);
  }

  return {
    name: node.props.name,
    description: node.props.description,
    parameters: normalizeToolParametersSchema(
      { type: "object", properties, required },
      `tool ${JSON.stringify(node.props.name)} schema`,
    ),
  };
}

function extractMessage(
  node: JsxAiNode & { type: "message" },
): PromptMessageInput {
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
