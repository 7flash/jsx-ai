import type { JsonObject, JsonValue } from "../types";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function jsonObject(value: unknown, context: string): JsonObject {
  if (!isRecord(value)) throw new TypeError(`${context} must be a JSON object`);
  return value as JsonObject;
}

export function parseJsonObject(text: string, context: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`${context} contains invalid JSON`, { cause: error });
  }
  return jsonObject(parsed, context);
}

export function jsonValue(value: unknown, context: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item, index) => jsonValue(item, `${context}[${index}]`));
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${context} is not JSON-serializable`);
    }
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value))
      result[key] = jsonValue(item, `${context}.${key}`);
    return result;
  }
  throw new TypeError(`${context} is not JSON-serializable`);
}
