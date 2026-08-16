// ── Custom JSX Runtime for jsx-ai ──
// This replaces React's createElement — every supported intrinsic tag becomes a JsxAiNode.

import { jsonObject, record } from "./internal/json";
import type {
  JsxAiNode,
  MessageNode,
  ParamNode,
  PromptNode,
  SystemNode,
  ToolCall,
  ToolNode,
} from "./types";

export type JsxChild =
  JsxAiNode | string | number | boolean | null | undefined | JsxChild[];

type FunctionComponent<Props> = (props: Props) => JsxAiNode;

type RuntimeProps = Record<string, unknown> & { children?: JsxChild };

export function jsx<Props>(
  tag: FunctionComponent<Props>,
  props: Props,
): JsxAiNode;
export function jsx(tag: string, props?: RuntimeProps): JsxAiNode;
export function jsx(
  tag: string | FunctionComponent<never>,
  props: RuntimeProps = {},
): JsxAiNode {
  if (typeof tag === "function") return tag(props as never);

  const { children, ...rest } = props;
  const normalizedChildren = normalizeChildren(children);

  switch (tag) {
    case "tool":
      return toolNode(rest, normalizedChildren);
    case "param":
      return paramNode(rest, normalizedChildren);
    case "message":
      return messageNode(rest, normalizedChildren);
    case "system":
      return systemNode(normalizedChildren);
    case "prompt":
      return promptNode(rest, normalizedChildren);
    default:
      throw new Error(
        `[jsx-ai] Unknown JSX tag <${tag}>. Supported tags: prompt, system, message, tool, param.`,
      );
  }
}

/** jsxs — same as jsx but used by the automatic runtime for static children. */
export const jsxs = jsx;

/** Fragment support: <></> becomes a FragmentNode. */
export function Fragment(props: { children?: JsxChild }): JsxAiNode {
  const children = normalizeChildren(props.children);
  return {
    type: "fragment",
    children: Array.isArray(children) ? children : children ? [children] : [],
  };
}

function toolNode(
  props: Record<string, unknown>,
  children: JsxAiNode | JsxAiNode[] | undefined,
): ToolNode {
  return {
    type: "tool",
    props: {
      name: requiredString(props.name, "tool", "name"),
      description: requiredString(props.description, "tool", "description"),
      children,
    },
  };
}

function paramNode(
  props: Record<string, unknown>,
  children: JsxAiNode | JsxAiNode[] | undefined,
): ParamNode {
  const enumValues =
    props.enum === undefined
      ? undefined
      : stringArray(props.enum, "param", "enum");
  return {
    type: "param",
    props: {
      name: requiredString(props.name, "param", "name"),
      ...(typeof props.type === "string" ? { type: props.type } : {}),
      ...(props.required === true ? { required: true } : {}),
      ...(enumValues ? { enum: enumValues } : {}),
      ...(extractText(children) !== undefined
        ? { children: extractText(children) }
        : {}),
    },
  };
}

function messageNode(
  props: Record<string, unknown>,
  children: JsxAiNode | JsxAiNode[] | undefined,
): MessageNode {
  const role = props.role;
  if (role !== "user" && role !== "assistant" && role !== "tool") {
    throw new TypeError(
      `<message> role must be user, assistant, or tool; received ${String(role)}`,
    );
  }
  const toolCalls =
    props.toolCalls === undefined ? undefined : toolCallArray(props.toolCalls);
  return {
    type: "message",
    props: {
      role,
      ...(toolCalls ? { toolCalls } : {}),
      ...(typeof props.toolCallId === "string"
        ? { toolCallId: props.toolCallId }
        : {}),
      ...(typeof props.toolName === "string"
        ? { toolName: props.toolName }
        : {}),
      ...(props.isError === true ? { isError: true } : {}),
      children,
    },
  };
}

function systemNode(children: JsxAiNode | JsxAiNode[] | undefined): SystemNode {
  return { type: "system", props: { children } };
}

function promptNode(
  props: Record<string, unknown>,
  children: JsxAiNode | JsxAiNode[] | undefined,
): PromptNode {
  return {
    type: "prompt",
    props: {
      ...(typeof props.model === "string" ? { model: props.model } : {}),
      ...(typeof props.provider === "string"
        ? { provider: props.provider }
        : {}),
      ...(typeof props.temperature === "number"
        ? { temperature: props.temperature }
        : {}),
      ...(typeof props.maxTokens === "number"
        ? { maxTokens: props.maxTokens }
        : {}),
      ...(typeof props.strategy === "string"
        ? { strategy: props.strategy }
        : {}),
      children,
    },
  };
}

function requiredString(value: unknown, tag: string, prop: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`<${tag}> requires a non-empty ${prop} string`);
  }
  return value;
}

function stringArray(value: unknown, tag: string, prop: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new TypeError(`<${tag}> ${prop} must be a string array`);
  }
  return value;
}

function toolCallArray(value: unknown): ToolCall[] {
  if (!Array.isArray(value))
    throw new TypeError("<message> toolCalls must be an array");
  return value.map((item, index) => {
    const candidate = record(item);
    if (!candidate) {
      throw new TypeError(`<message> toolCalls[${index}] must be an object`);
    }
    if (typeof candidate.name !== "string" || candidate.name.length === 0) {
      throw new TypeError(
        `<message> toolCalls[${index}] requires a non-empty name`,
      );
    }
    if (candidate.id !== undefined && typeof candidate.id !== "string") {
      throw new TypeError(
        `<message> toolCalls[${index}].id must be a string when provided`,
      );
    }
    return {
      ...(candidate.id ? { id: candidate.id } : {}),
      name: candidate.name,
      args: jsonObject(
        candidate.args ?? {},
        `<message> toolCalls[${index}].args`,
      ),
    };
  });
}

function normalizeChildren(
  children: JsxChild,
): JsxAiNode | JsxAiNode[] | undefined {
  if (children == null || children === false || children === true)
    return undefined;
  if (typeof children === "string" || typeof children === "number") {
    return { type: "text", value: String(children) };
  }
  if (Array.isArray(children)) {
    const normalized: JsxAiNode[] = [];
    for (const child of children) {
      const value = normalizeChildren(child);
      if (Array.isArray(value)) normalized.push(...value);
      else if (value) normalized.push(value);
    }
    return normalized;
  }
  if (isJsxNode(children)) return children;
  throw new TypeError("Invalid JSX child passed to jsx-ai");
}

function isJsxNode(value: unknown): value is JsxAiNode {
  const candidate = record(value);
  if (!candidate) return false;
  const type = candidate.type;
  return (
    type === "tool" ||
    type === "param" ||
    type === "message" ||
    type === "system" ||
    type === "prompt" ||
    type === "text" ||
    type === "fragment"
  );
}

function extractText(
  children: JsxAiNode | JsxAiNode[] | undefined,
): string | undefined {
  if (!children) return undefined;
  const nodes = Array.isArray(children) ? children : [children];
  const text = nodes
    .filter(
      (node): node is { type: "text"; value: string } => node.type === "text",
    )
    .map((node) => node.value)
    .join("");
  return text || undefined;
}

/** Dedent tagged template for readable multi-line prompt text inside JSX. */
export function md(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  const text = strings.reduce(
    (acc, part, index) => acc + part + String(values[index] ?? ""),
    "",
  );
  const lines = text.split("\n");
  if (lines[0]?.trim() === "") lines.shift();
  if (lines.at(-1)?.trim() === "") lines.pop();

  const indent = lines
    .filter((line) => line.trim().length > 0)
    .reduce(
      (minimum, line) =>
        Math.min(minimum, line.match(/^(\s*)/)?.[1]?.length ?? 0),
      Infinity,
    );

  return (
    indent === Infinity ? lines : lines.map((line) => line.slice(indent))
  ).join("\n");
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      tool: { name: string; description: string; children?: JsxChild };
      param: {
        name: string;
        type?: string;
        required?: boolean;
        enum?: string[];
        children?: JsxChild;
      };
      message: {
        role: "user" | "assistant" | "tool";
        toolCalls?: ToolCall[];
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
        children?: JsxChild;
      };
      system: { children?: JsxChild };
      prompt: {
        model?: string;
        provider?: import("./types").ProviderName;
        temperature?: number;
        maxTokens?: number;
        strategy?: import("./types").StrategyName;
        children?: JsxChild;
      };
    }
  }
}
