import { isRecord, jsonValue } from "./internal/json";
import type {
  CanonicalToolCall,
  ExtractedMessage,
  ExtractedPrompt,
  ExtractedTool,
  JsonObject,
  JsonSchema,
  JsonSchemaType,
  JsonValue,
  PreparedPrompt,
  ToolCall,
  ToolParametersSchema,
} from "./types";

const SCHEMA_TYPES = new Set<JsonSchemaType>([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);

export interface PromptMessageInput {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
}

export interface PromptIRInput {
  readonly tools: readonly ExtractedTool[];
  readonly messages: readonly PromptMessageInput[];
  readonly system?: string;
  readonly model?: string;
  readonly providerOverride?: ExtractedPrompt["providerOverride"];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly strategy?: ExtractedPrompt["strategy"];
}

const SCHEMA_KEYS = new Set([
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "enum",
  "const",
  "default",
  "examples",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "items",
  "prefixItems",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

function fail(context: string, message: string): never {
  throw new TypeError(`${context} ${message}`);
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(context, "must be a non-empty string");
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(context, "must be a string");
  return value;
}

function finiteNumber(value: unknown, context: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(context, "must be a finite number");
  return value;
}

function nonNegativeInteger(
  value: unknown,
  context: string,
): number | undefined {
  const number = finiteNumber(value, context);
  if (number === undefined) return undefined;
  if (!Number.isInteger(number) || number < 0)
    fail(context, "must be a non-negative integer");
  return number;
}

function stringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) fail(context, "must be an array");
  const items = value.map((item, index) =>
    nonEmptyString(item, `${context}[${index}]`),
  );
  if (new Set(items).size !== items.length)
    fail(context, "must not contain duplicates");
  return items;
}

function schemaType(
  value: unknown,
  context: string,
): JsonSchemaType | JsonSchemaType[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (!SCHEMA_TYPES.has(value as JsonSchemaType))
      fail(context, `contains unsupported type ${JSON.stringify(value)}`);
    return value as JsonSchemaType;
  }
  const types = stringArray(value, context);
  for (const type of types) {
    if (!SCHEMA_TYPES.has(type as JsonSchemaType))
      fail(context, `contains unsupported type ${JSON.stringify(type)}`);
  }
  return types as JsonSchemaType[];
}

function normalizeJson(value: unknown, context: string): JsonValue {
  return jsonValue(value, context);
}

function schemaRecord(
  value: unknown,
  context: string,
): Record<string, JsonSchema> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(context, "must be an object");
  const result: Record<string, JsonSchema> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!key) fail(context, "must not contain empty property names");
    result[key] = normalizeJsonSchema(child, `${context}.${key}`);
  }
  return Object.freeze(result);
}

function schemaArray(
  value: unknown,
  context: string,
): JsonSchema[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0)
    fail(context, "must be a non-empty array");
  return Object.freeze(
    value.map((item, index) =>
      normalizeJsonSchema(item, `${context}[${index}]`),
    ),
  ) as JsonSchema[];
}

function dependentRequired(
  value: unknown,
  context: string,
): Record<string, readonly string[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(context, "must be an object");
  const result: Record<string, readonly string[]> = {};
  for (const [key, names] of Object.entries(value))
    result[key] = Object.freeze(stringArray(names, `${context}.${key}`));
  return Object.freeze(result);
}

/** Validate, clone, and deeply freeze a provider-neutral JSON Schema. */
export function normalizeJsonSchema(
  value: unknown,
  context = "JSON Schema",
): JsonSchema {
  if (!isRecord(value)) fail(context, "must be an object");
  for (const key of Object.keys(value)) {
    if (!SCHEMA_KEYS.has(key))
      fail(context, `contains unsupported keyword ${JSON.stringify(key)}`);
  }

  const type = schemaType(value.type, `${context}.type`);
  const required =
    value.required === undefined
      ? undefined
      : Object.freeze(stringArray(value.required, `${context}.required`));
  const properties = schemaRecord(value.properties, `${context}.properties`);
  if (required && properties) {
    for (const name of required) {
      if (!(name in properties))
        fail(
          `${context}.required`,
          `references undeclared property ${JSON.stringify(name)}`,
        );
    }
  }

  let additionalProperties: boolean | JsonSchema | undefined;
  if (value.additionalProperties !== undefined) {
    if (typeof value.additionalProperties === "boolean")
      additionalProperties = value.additionalProperties;
    else
      additionalProperties = normalizeJsonSchema(
        value.additionalProperties,
        `${context}.additionalProperties`,
      );
  }

  const enumValues =
    value.enum === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(value.enum) || value.enum.length === 0)
            fail(`${context}.enum`, "must be a non-empty array");
          return Object.freeze(
            value.enum.map((item, index) =>
              normalizeJson(item, `${context}.enum[${index}]`),
            ),
          );
        })();
  const examples =
    value.examples === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(value.examples))
            fail(`${context}.examples`, "must be an array");
          return Object.freeze(
            value.examples.map((item, index) =>
              normalizeJson(item, `${context}.examples[${index}]`),
            ),
          );
        })();
  const defs = schemaRecord(value.$defs, `${context}.$defs`);
  const patternProperties = schemaRecord(
    value.patternProperties,
    `${context}.patternProperties`,
  );
  const dependencies = dependentRequired(
    value.dependentRequired,
    `${context}.dependentRequired`,
  );
  const prefixItems = schemaArray(value.prefixItems, `${context}.prefixItems`);
  const oneOf = schemaArray(value.oneOf, `${context}.oneOf`);
  const anyOf = schemaArray(value.anyOf, `${context}.anyOf`);
  const allOf = schemaArray(value.allOf, `${context}.allOf`);

  const result: JsonSchema = {
    ...(optionalString(value.$ref, `${context}.$ref`) !== undefined
      ? { $ref: value.$ref as string }
      : {}),
    ...(defs ? { $defs: defs } : {}),
    ...(optionalString(value.title, `${context}.title`) !== undefined
      ? { title: value.title as string }
      : {}),
    ...(optionalString(value.description, `${context}.description`) !==
    undefined
      ? { description: value.description as string }
      : {}),
    ...(type !== undefined
      ? { type: Array.isArray(type) ? Object.freeze(type) : type }
      : {}),
    ...(enumValues ? { enum: enumValues } : {}),
    ...(value.const !== undefined
      ? { const: normalizeJson(value.const, `${context}.const`) }
      : {}),
    ...(value.default !== undefined
      ? { default: normalizeJson(value.default, `${context}.default`) }
      : {}),
    ...(examples ? { examples } : {}),
    ...(properties ? { properties } : {}),
    ...(required ? { required } : {}),
    ...(additionalProperties !== undefined ? { additionalProperties } : {}),
    ...(patternProperties ? { patternProperties } : {}),
    ...(value.propertyNames !== undefined
      ? {
          propertyNames: normalizeJsonSchema(
            value.propertyNames,
            `${context}.propertyNames`,
          ),
        }
      : {}),
    ...(dependencies ? { dependentRequired: dependencies } : {}),
    ...(value.items !== undefined
      ? { items: normalizeJsonSchema(value.items, `${context}.items`) }
      : {}),
    ...(prefixItems ? { prefixItems } : {}),
    ...(oneOf ? { oneOf } : {}),
    ...(anyOf ? { anyOf } : {}),
    ...(allOf ? { allOf } : {}),
    ...(value.not !== undefined
      ? { not: normalizeJsonSchema(value.not, `${context}.not`) }
      : {}),
    ...(finiteNumber(value.minimum, `${context}.minimum`) !== undefined
      ? { minimum: value.minimum as number }
      : {}),
    ...(finiteNumber(value.maximum, `${context}.maximum`) !== undefined
      ? { maximum: value.maximum as number }
      : {}),
    ...(finiteNumber(value.exclusiveMinimum, `${context}.exclusiveMinimum`) !==
    undefined
      ? { exclusiveMinimum: value.exclusiveMinimum as number }
      : {}),
    ...(finiteNumber(value.exclusiveMaximum, `${context}.exclusiveMaximum`) !==
    undefined
      ? { exclusiveMaximum: value.exclusiveMaximum as number }
      : {}),
    ...(finiteNumber(value.multipleOf, `${context}.multipleOf`) !== undefined
      ? { multipleOf: value.multipleOf as number }
      : {}),
    ...(nonNegativeInteger(value.minLength, `${context}.minLength`) !==
    undefined
      ? { minLength: value.minLength as number }
      : {}),
    ...(nonNegativeInteger(value.maxLength, `${context}.maxLength`) !==
    undefined
      ? { maxLength: value.maxLength as number }
      : {}),
    ...(optionalString(value.pattern, `${context}.pattern`) !== undefined
      ? { pattern: value.pattern as string }
      : {}),
    ...(optionalString(value.format, `${context}.format`) !== undefined
      ? { format: value.format as string }
      : {}),
    ...(nonNegativeInteger(value.minItems, `${context}.minItems`) !== undefined
      ? { minItems: value.minItems as number }
      : {}),
    ...(nonNegativeInteger(value.maxItems, `${context}.maxItems`) !== undefined
      ? { maxItems: value.maxItems as number }
      : {}),
    ...(value.uniqueItems !== undefined
      ? (() => {
          if (typeof value.uniqueItems !== "boolean")
            fail(`${context}.uniqueItems`, "must be boolean");
          return { uniqueItems: value.uniqueItems };
        })()
      : {}),
    ...(nonNegativeInteger(value.minProperties, `${context}.minProperties`) !==
    undefined
      ? { minProperties: value.minProperties as number }
      : {}),
    ...(nonNegativeInteger(value.maxProperties, `${context}.maxProperties`) !==
    undefined
      ? { maxProperties: value.maxProperties as number }
      : {}),
  };

  if (result.multipleOf !== undefined && result.multipleOf <= 0)
    fail(`${context}.multipleOf`, "must be greater than zero");
  if (
    result.minLength !== undefined &&
    result.maxLength !== undefined &&
    result.minLength > result.maxLength
  )
    fail(context, "has minLength greater than maxLength");
  if (
    result.minItems !== undefined &&
    result.maxItems !== undefined &&
    result.minItems > result.maxItems
  )
    fail(context, "has minItems greater than maxItems");
  if (
    result.minProperties !== undefined &&
    result.maxProperties !== undefined &&
    result.minProperties > result.maxProperties
  )
    fail(context, "has minProperties greater than maxProperties");
  if (
    result.minimum !== undefined &&
    result.maximum !== undefined &&
    result.minimum > result.maximum
  )
    fail(context, "has minimum greater than maximum");

  return Object.freeze(result);
}

/** Tool APIs require an object-shaped root schema, even when nested properties use richer schemas. */
export function normalizeToolParametersSchema(
  value: unknown,
  context = "Tool parameters",
): ToolParametersSchema {
  const schema = normalizeJsonSchema(value, context);
  if (schema.type !== "object") fail(context, 'must declare type: "object"');
  const properties = schema.properties ?? Object.freeze({});
  const required = schema.required ?? Object.freeze([]);
  for (const name of required) {
    if (!(name in properties))
      fail(
        `${context}.required`,
        `references undeclared property ${JSON.stringify(name)}`,
      );
  }
  return Object.freeze({
    ...schema,
    type: "object",
    properties,
    required,
  }) as ToolParametersSchema;
}

/** Clone a frozen schema to plain JSON for provider request bodies. */
export function jsonSchemaToJson(schema: JsonSchema): JsonObject {
  const value = jsonValue(schema, "JSON Schema");
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("JSON Schema must serialize to an object");
  }
  return value;
}

function normalizeArgs(value: unknown, context: string): JsonObject {
  const normalized = jsonValue(value, context);
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  )
    fail(context, "must be a JSON object");
  return deepFreezeJson(normalized) as JsonObject;
}

function normalizeProviderMetadata(
  value: ToolCall["providerMetadata"],
  context: string,
): Readonly<Record<string, JsonObject>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    fail(context, "must be an object keyed by provider name");
  const result: Record<string, JsonObject> = {};
  for (const [provider, metadata] of Object.entries(value)) {
    nonEmptyString(provider, `${context} provider name`);
    result[provider] = normalizeArgs(metadata, `${context}.${provider}`);
  }
  return Object.freeze(result);
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJson(item);
    return Object.freeze(value) as JsonValue;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreezeJson(item);
    return Object.freeze(value);
  }
  return value;
}

export function normalizeToolCall(
  call: ToolCall,
  fallbackId: string,
  context = "tool call",
): CanonicalToolCall {
  const name = nonEmptyString(call.name, `${context}.name`);
  const id =
    call.id === undefined
      ? nonEmptyString(fallbackId, `${context}.fallbackId`)
      : nonEmptyString(call.id, `${context}.id`);
  const providerMetadata = normalizeProviderMetadata(
    call.providerMetadata,
    `${context}.providerMetadata`,
  );
  return Object.freeze({
    id,
    name,
    args: normalizeArgs(call.args ?? {}, `${context}.args`),
    ...(providerMetadata ? { providerMetadata } : {}),
  });
}

function normalizeMessage(
  message: PromptMessageInput,
  index: number,
): ExtractedMessage {
  const content =
    typeof message.content === "string"
      ? message.content
      : fail(`messages[${index}].content`, "must be a string");

  if (message.role === "user") {
    if (
      message.toolCalls !== undefined ||
      message.toolCallId !== undefined ||
      message.toolName !== undefined ||
      message.isError !== undefined
    ) {
      fail(
        `messages[${index}]`,
        "user messages cannot contain tool-call/result fields",
      );
    }
    if (!content.trim())
      fail(`messages[${index}]`, "user messages must contain text");
    return Object.freeze({ role: "user", content });
  }

  if (message.role === "assistant") {
    if (
      message.toolCallId !== undefined ||
      message.toolName !== undefined ||
      message.isError !== undefined
    ) {
      fail(
        `messages[${index}]`,
        "assistant messages cannot contain tool-result fields",
      );
    }
    const toolCalls = message.toolCalls?.map((call, callIndex) =>
      normalizeToolCall(
        call,
        `jsx_ir_${index}_${callIndex}_${call.name}`,
        `messages[${index}].toolCalls[${callIndex}]`,
      ),
    );
    if (!content.trim() && !toolCalls?.length)
      fail(
        `messages[${index}]`,
        "assistant messages require text or tool calls",
      );
    if (
      toolCalls &&
      new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length
    ) {
      fail(`messages[${index}].toolCalls`, "must have unique IDs");
    }
    return Object.freeze({
      role: "assistant",
      content,
      ...(toolCalls?.length ? { toolCalls: Object.freeze(toolCalls) } : {}),
    });
  }

  if (message.role === "tool") {
    if (message.toolCalls !== undefined)
      fail(
        `messages[${index}]`,
        "tool result messages cannot contain toolCalls",
      );
    const toolCallId = nonEmptyString(
      message.toolCallId,
      `messages[${index}].toolCallId`,
    );
    const toolName = nonEmptyString(
      message.toolName,
      `messages[${index}].toolName`,
    );
    return Object.freeze({
      role: "tool",
      content,
      toolCallId,
      toolName,
      ...(message.isError ? { isError: true } : {}),
    });
  }

  return fail(`messages[${index}].role`, "must be user, assistant, or tool");
}

function validateToolHistory(messages: readonly ExtractedMessage[]): void {
  let pending: Map<string, string> | undefined;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (pending?.size) {
      if (message.role !== "tool") {
        fail(
          `messages[${index}]`,
          `must resolve pending tool calls before the next ${message.role} message`,
        );
      }
      const expectedName = pending.get(message.toolCallId ?? "");
      if (!expectedName)
        fail(
          `messages[${index}].toolCallId`,
          `does not match a pending assistant tool call`,
        );
      if (expectedName !== message.toolName) {
        fail(
          `messages[${index}].toolName`,
          `must match pending tool ${JSON.stringify(expectedName)}`,
        );
      }
      pending.delete(message.toolCallId ?? "");
      if (pending.size === 0) pending = undefined;
      continue;
    }

    if (message.role === "tool")
      fail(`messages[${index}]`, "is an orphaned tool result");
    if (message.role === "assistant" && message.toolCalls?.length) {
      pending = new Map(message.toolCalls.map((call) => [call.id, call.name]));
    }
  }

  if (pending?.size) {
    fail(
      "messages",
      `end with unresolved tool calls: ${[...pending.keys()].join(", ")}`,
    );
  }
}

function normalizeTool(tool: ExtractedTool, index: number): ExtractedTool {
  const name = nonEmptyString(tool.name, `tools[${index}].name`);
  if (!/^[A-Za-z0-9_.-]+$/.test(name))
    fail(
      `tools[${index}].name`,
      "may contain only letters, numbers, _, -, and .",
    );
  const description = nonEmptyString(
    tool.description,
    `tools[${index}].description`,
  );
  return Object.freeze({
    name,
    description,
    parameters: normalizeToolParametersSchema(
      tool.parameters,
      `tools[${index}].parameters`,
    ),
  });
}

function optionalFinite(
  value: number | undefined,
  context: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) fail(context, "must be finite");
  return value;
}

function optionalPositiveInteger(
  value: number | undefined,
  context: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0)
    fail(context, "must be a positive integer");
  return value;
}

/**
 * Normalize the canonical prompt IR. This is the single validation boundary used
 * by JSX extraction and by call-time overrides.
 */
export function normalizePromptIR(prompt: PromptIRInput): ExtractedPrompt {
  if (!Array.isArray(prompt.tools)) fail("tools", "must be an array");
  if (!Array.isArray(prompt.messages)) fail("messages", "must be an array");
  const tools = prompt.tools.map(normalizeTool);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    fail("tools", "must have unique names");
  const messages = prompt.messages.map(normalizeMessage);
  validateToolHistory(messages);

  const system =
    prompt.system === undefined
      ? undefined
      : optionalString(prompt.system, "system");
  const normalized: ExtractedPrompt = {
    tools: Object.freeze(tools),
    messages: Object.freeze(messages),
    ...(system?.trim() ? { system } : {}),
    ...(prompt.model !== undefined
      ? { model: nonEmptyString(prompt.model, "model") }
      : {}),
    ...(prompt.providerOverride !== undefined
      ? {
          providerOverride: nonEmptyString(
            prompt.providerOverride,
            "providerOverride",
          ),
        }
      : {}),
    ...(optionalFinite(prompt.temperature, "temperature") !== undefined
      ? { temperature: prompt.temperature }
      : {}),
    ...(optionalPositiveInteger(prompt.maxTokens, "maxTokens") !== undefined
      ? { maxTokens: prompt.maxTokens }
      : {}),
    ...(prompt.strategy !== undefined
      ? { strategy: nonEmptyString(prompt.strategy, "strategy") }
      : {}),
  };
  return Object.freeze(normalized);
}

/** Validate custom-strategy output before it reaches a provider backend. */
export function normalizePreparedPrompt(
  prepared: PreparedPrompt,
): PreparedPrompt {
  if (!prepared.messages.length)
    fail("prepared.messages", "must contain at least one message");
  const prompt = normalizePromptIR({
    tools: prepared.nativeTools ?? [],
    messages: prepared.messages,
    ...(prepared.system ? { system: prepared.system } : {}),
    ...(prepared.temperature !== undefined
      ? { temperature: prepared.temperature }
      : {}),
    ...(prepared.maxTokens !== undefined
      ? { maxTokens: prepared.maxTokens }
      : {}),
  });
  return Object.freeze({
    messages: prompt.messages,
    ...(prompt.system ? { system: prompt.system } : {}),
    ...(prompt.tools.length ? { nativeTools: prompt.tools } : {}),
    ...(prompt.temperature !== undefined
      ? { temperature: prompt.temperature }
      : {}),
    ...(prompt.maxTokens !== undefined ? { maxTokens: prompt.maxTokens } : {}),
  });
}

export function schemaTypeLabel(schema: JsonSchema): string {
  if (!schema.type) return "any";
  return typeof schema.type === "string" ? schema.type : schema.type.join("|");
}
