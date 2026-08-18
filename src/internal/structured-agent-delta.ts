import type { JsonValue } from "../types";

export type StructuredToolProgress =
  | { type: "tool_detected"; index: number; name: string }
  | {
      type: "field_delta";
      index: number;
      name?: string;
      path: readonly string[];
      delta: string;
    }
  | {
      type: "field_ready";
      index: number;
      name?: string;
      path: readonly string[];
      value: JsonValue;
    };

export interface StructuredAgentDelta {
  textDelta: string;
  toolProgress: StructuredToolProgress[];
}

type FieldState =
  | "before_root"
  | "key"
  | "colon"
  | "value"
  | "primitive"
  | "composite"
  | "after_value"
  | "done";
type FieldStringMode = "key" | "value";

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function parseJsonValue(source: string): JsonValue | undefined {
  try {
    return JSON.parse(source) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Incrementally parses one tool-call argument object from the structured response.
 *
 * String values emit `field_delta` while they are being decoded. Every top-level
 * argument emits exactly one `field_ready` once its JSON value is complete.
 * Nested objects/arrays remain atomic values for now; their complete value is
 * surfaced through the parent field path instead of leaking raw JSON fragments.
 */
class JsonObjectFieldProgressDecoder {
  private state: FieldState = "before_root";
  private stringMode: FieldStringMode | undefined;
  private currentKey = "";
  private key = "";
  private stringValue = "";
  private escaped = false;
  private decodingUnicode = false;
  private unicode = "";
  private primitive = "";
  private composite = "";
  private compositeDepth = 0;
  private compositeInString = false;
  private compositeEscaped = false;

  get complete(): boolean {
    return this.state === "done";
  }

  push(
    chunk: string,
  ): Array<
    | { type: "field_delta"; path: readonly string[]; delta: string }
    | { type: "field_ready"; path: readonly string[]; value: JsonValue }
  > {
    const events: Array<
      | { type: "field_delta"; path: readonly string[]; delta: string }
      | { type: "field_ready"; path: readonly string[]; value: JsonValue }
    > = [];

    const appendDelta = (delta: string) => {
      if (!delta) return;
      const previous = events.at(-1);
      if (
        previous?.type === "field_delta" &&
        previous.path.length === 1 &&
        previous.path[0] === this.currentKey
      ) {
        events[events.length - 1] = {
          ...previous,
          delta: previous.delta + delta,
        };
        return;
      }
      events.push({ type: "field_delta", path: [this.currentKey], delta });
    };

    const completePrimitive = () => {
      const source = this.primitive.trim();
      this.primitive = "";
      if (!source) return;
      const value = parseJsonValue(source);
      if (value !== undefined) {
        events.push({ type: "field_ready", path: [this.currentKey], value });
      }
    };

    const completeComposite = () => {
      const source = this.composite;
      this.composite = "";
      const value = parseJsonValue(source);
      if (value !== undefined) {
        events.push({ type: "field_ready", path: [this.currentKey], value });
      }
    };

    for (const char of chunk) {
      if (this.stringMode) {
        const decoded = this.consumeStringChar(char);
        if (decoded === undefined) continue;
        if (decoded === null) {
          const mode = this.stringMode;
          this.stringMode = undefined;
          this.escaped = false;
          this.decodingUnicode = false;
          this.unicode = "";

          if (mode === "key") {
            this.currentKey = this.key;
            this.key = "";
            this.state = "colon";
          } else {
            events.push({
              type: "field_ready",
              path: [this.currentKey],
              value: this.stringValue,
            });
            this.stringValue = "";
            this.state = "after_value";
          }
          continue;
        }

        if (this.stringMode === "key") {
          this.key += decoded;
        } else {
          this.stringValue += decoded;
          appendDelta(decoded);
        }
        continue;
      }

      if (this.state === "done") continue;

      if (this.state === "before_root") {
        if (/\s/.test(char)) continue;
        if (char === "{") this.state = "key";
        continue;
      }

      if (this.state === "key") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "}") {
          this.state = "done";
          continue;
        }
        if (char === '"') {
          this.stringMode = "key";
          this.key = "";
          this.resetStringDecoder();
        }
        continue;
      }

      if (this.state === "colon") {
        if (/\s/.test(char)) continue;
        if (char === ":") this.state = "value";
        continue;
      }

      if (this.state === "value") {
        if (/\s/.test(char)) continue;
        if (char === '"') {
          this.stringMode = "value";
          this.stringValue = "";
          this.resetStringDecoder();
          continue;
        }
        if (char === "{" || char === "[") {
          this.state = "composite";
          this.composite = char;
          this.compositeDepth = 1;
          this.compositeInString = false;
          this.compositeEscaped = false;
          continue;
        }
        this.state = "primitive";
        this.primitive = char;
        continue;
      }

      if (this.state === "primitive") {
        if (char === ",") {
          completePrimitive();
          this.currentKey = "";
          this.state = "key";
        } else if (char === "}") {
          completePrimitive();
          this.state = "done";
        } else {
          this.primitive += char;
        }
        continue;
      }

      if (this.state === "composite") {
        this.composite += char;
        if (this.compositeInString) {
          if (this.compositeEscaped) {
            this.compositeEscaped = false;
          } else if (char === "\\") {
            this.compositeEscaped = true;
          } else if (char === '"') {
            this.compositeInString = false;
          }
          continue;
        }

        if (char === '"') {
          this.compositeInString = true;
          continue;
        }
        if (char === "{" || char === "[") this.compositeDepth++;
        else if (char === "}" || char === "]") this.compositeDepth--;

        if (this.compositeDepth === 0) {
          completeComposite();
          this.state = "after_value";
        }
        continue;
      }

      if (this.state === "after_value") {
        if (/\s/.test(char)) continue;
        if (char === ",") {
          this.currentKey = "";
          this.state = "key";
        } else if (char === "}") {
          this.state = "done";
        }
      }
    }

    return events;
  }

  private resetStringDecoder(): void {
    this.escaped = false;
    this.decodingUnicode = false;
    this.unicode = "";
  }

  /** undefined = escape still incomplete, null = closing quote, string = decoded content. */
  private consumeStringChar(char: string): string | null | undefined {
    if (this.decodingUnicode) {
      this.unicode += char;
      if (this.unicode.length < 4) return undefined;
      if (!/^[0-9A-Fa-f]{4}$/.test(this.unicode)) {
        throw new Error(`Invalid JSON unicode escape: \\u${this.unicode}`);
      }
      const code = Number.parseInt(this.unicode, 16);
      this.decodingUnicode = false;
      this.unicode = "";
      this.escaped = false;
      return String.fromCharCode(code);
    }

    if (this.escaped) {
      if (char === "u") {
        this.decodingUnicode = true;
        this.unicode = "";
        return undefined;
      }
      this.escaped = false;
      const decoded = ESCAPES[char];
      if (decoded === undefined) {
        throw new Error(`Invalid JSON escape: \\${char}`);
      }
      return decoded;
    }

    if (char === "\\") {
      this.escaped = true;
      return undefined;
    }
    if (char === '"') return null;
    if (char.charCodeAt(0) <= 0x1f) {
      throw new Error("Invalid unescaped control character in JSON string");
    }
    return char;
  }
}

type OuterState =
  | "before_root"
  | "root_key"
  | "root_colon"
  | "root_value"
  | "root_after_value"
  | "tool_array"
  | "tool_key"
  | "tool_colon"
  | "tool_value"
  | "tool_arguments"
  | "tool_after_value"
  | "skip_primitive"
  | "skip_nested"
  | "done";

type OuterStringMode =
  "root_key" | "tool_key" | "text" | "tool_name" | "arguments_json" | "skip";
type ReturnState = "root_after_value" | "tool_after_value";

/**
 * Incrementally decodes jsx-ai's Codex structured-response envelope.
 *
 * Only semantic information is exposed: visible assistant text, discovered tool
 * names, decoded string-field deltas inside direct `arguments` objects, and completed
 * argument fields. Legacy `arguments_json` responses are still decoded defensively.
 * Raw partial JSON is never returned to application code.
 */
export class StructuredAgentDeltaDecoder {
  private state: OuterState = "before_root";
  private stringMode: OuterStringMode | undefined;
  private returnState: ReturnState = "root_after_value";
  private key = "";
  private currentKey = "";
  private escaped = false;
  private decodingUnicode = false;
  private unicode = "";
  private skipDepth = 0;
  private skipInString = false;
  private skipEscaped = false;
  private toolIndex = -1;
  private toolName: string | undefined;
  private toolNameBuffer = "";
  private argumentsDecoder: JsonObjectFieldProgressDecoder | undefined;
  private argumentsDecodedBuffer = "";
  private decodedText = "";

  get text(): string {
    return this.decodedText;
  }

  push(chunk: string): StructuredAgentDelta {
    let textDelta = "";
    const toolProgress: StructuredToolProgress[] = [];

    const emitArgumentProgress = (source: string) => {
      if (!source || !this.argumentsDecoder || this.toolIndex < 0) return;
      for (const event of this.argumentsDecoder.push(source)) {
        toolProgress.push({
          ...event,
          index: this.toolIndex,
          ...(this.toolName ? { name: this.toolName } : {}),
        });
      }
    };

    const flushLegacyArguments = () => {
      if (!this.argumentsDecodedBuffer) return;
      const decoded = this.argumentsDecodedBuffer;
      this.argumentsDecodedBuffer = "";
      emitArgumentProgress(decoded);
    };

    for (const char of chunk) {
      if (this.stringMode) {
        const decoded = this.consumeStringChar(char);
        if (decoded === undefined) continue;

        if (decoded === null) {
          const mode = this.stringMode;
          if (mode === "arguments_json") flushLegacyArguments();
          this.stringMode = undefined;
          this.resetStringDecoder();

          if (mode === "root_key" || mode === "tool_key") {
            this.currentKey = this.key;
            this.key = "";
            this.state = mode === "root_key" ? "root_colon" : "tool_colon";
          } else if (mode === "tool_name") {
            this.toolName = this.toolNameBuffer;
            this.toolNameBuffer = "";
            if (this.toolName && this.toolIndex >= 0) {
              toolProgress.push({
                type: "tool_detected",
                index: this.toolIndex,
                name: this.toolName,
              });
            }
            this.state = "tool_after_value";
          } else {
            this.state = this.returnState;
          }
          continue;
        }

        if (this.stringMode === "root_key" || this.stringMode === "tool_key") {
          this.key += decoded;
        } else if (this.stringMode === "text") {
          textDelta += decoded;
          this.decodedText += decoded;
        } else if (this.stringMode === "tool_name") {
          this.toolNameBuffer += decoded;
        } else if (this.stringMode === "arguments_json") {
          this.argumentsDecodedBuffer += decoded;
        }
        continue;
      }

      if (this.state === "done") continue;

      if (this.state === "tool_arguments") {
        emitArgumentProgress(char);
        if (this.argumentsDecoder?.complete) this.state = "tool_after_value";
        continue;
      }

      if (this.state === "skip_nested") {
        if (this.skipInString) {
          if (this.skipEscaped) this.skipEscaped = false;
          else if (char === "\\") this.skipEscaped = true;
          else if (char === '"') this.skipInString = false;
          continue;
        }
        if (char === '"') this.skipInString = true;
        else if (char === "{" || char === "[") this.skipDepth++;
        else if (char === "}" || char === "]") {
          this.skipDepth--;
          if (this.skipDepth === 0) this.state = this.returnState;
        }
        continue;
      }

      if (this.state === "skip_primitive") {
        if (char === ",") {
          this.state =
            this.returnState === "root_after_value" ? "root_key" : "tool_key";
          this.currentKey = "";
        } else if (char === "}") {
          this.state =
            this.returnState === "root_after_value" ? "done" : "tool_array";
        }
        continue;
      }

      if (this.state === "before_root") {
        if (/\s/.test(char)) continue;
        if (char === "{") this.state = "root_key";
        continue;
      }

      if (this.state === "root_key") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "}") {
          this.state = "done";
          continue;
        }
        if (char === '"') this.startString("root_key", "root_after_value");
        continue;
      }

      if (this.state === "root_colon") {
        if (/\s/.test(char)) continue;
        if (char === ":") this.state = "root_value";
        continue;
      }

      if (this.state === "root_value") {
        if (/\s/.test(char)) continue;
        if (this.currentKey === "text" && char === '"') {
          this.startString("text", "root_after_value");
          continue;
        }
        if (this.currentKey === "toolCalls" && char === "[") {
          this.state = "tool_array";
          continue;
        }
        this.startSkippingValue(char, "root_after_value");
        continue;
      }

      if (this.state === "root_after_value") {
        if (/\s/.test(char)) continue;
        if (char === ",") {
          this.currentKey = "";
          this.state = "root_key";
        } else if (char === "}") {
          this.state = "done";
        }
        continue;
      }

      if (this.state === "tool_array") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "]") {
          this.state = "root_after_value";
          continue;
        }
        if (char === "{") {
          this.toolIndex++;
          this.toolName = undefined;
          this.toolNameBuffer = "";
          this.argumentsDecoder = new JsonObjectFieldProgressDecoder();
          this.argumentsDecodedBuffer = "";
          this.currentKey = "";
          this.state = "tool_key";
        }
        continue;
      }

      if (this.state === "tool_key") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "}") {
          flushLegacyArguments();
          this.state = "tool_array";
          continue;
        }
        if (char === '"') this.startString("tool_key", "tool_after_value");
        continue;
      }

      if (this.state === "tool_colon") {
        if (/\s/.test(char)) continue;
        if (char === ":") this.state = "tool_value";
        continue;
      }

      if (this.state === "tool_value") {
        if (/\s/.test(char)) continue;
        if (this.currentKey === "name" && char === '"') {
          this.toolNameBuffer = "";
          this.startString("tool_name", "tool_after_value");
          continue;
        }
        if (this.currentKey === "arguments" && char === "{") {
          this.argumentsDecoder = new JsonObjectFieldProgressDecoder();
          emitArgumentProgress(char);
          this.state = this.argumentsDecoder.complete
            ? "tool_after_value"
            : "tool_arguments";
          continue;
        }
        if (this.currentKey === "arguments_json" && char === '"') {
          // Backward-compatible read path for responses produced by older jsx-ai
          // Codex contracts. New contracts emit `arguments` as an object directly.
          this.argumentsDecoder = new JsonObjectFieldProgressDecoder();
          this.startString("arguments_json", "tool_after_value");
          continue;
        }
        this.startSkippingValue(char, "tool_after_value");
        continue;
      }

      if (this.state === "tool_after_value") {
        if (/\s/.test(char)) continue;
        if (char === ",") {
          this.currentKey = "";
          this.state = "tool_key";
        } else if (char === "}") {
          flushLegacyArguments();
          this.state = "tool_array";
        }
      }
    }

    flushLegacyArguments();
    return { textDelta, toolProgress };
  }

  private startString(mode: OuterStringMode, returnState: ReturnState): void {
    this.stringMode = mode;
    this.returnState = returnState;
    this.resetStringDecoder();
    if (mode === "root_key" || mode === "tool_key") this.key = "";
  }

  private startSkippingValue(char: string, returnState: ReturnState): void {
    this.returnState = returnState;
    if (char === '"') {
      this.startString("skip", returnState);
      return;
    }
    if (char === "{" || char === "[") {
      this.state = "skip_nested";
      this.skipDepth = 1;
      this.skipInString = false;
      this.skipEscaped = false;
      return;
    }
    this.state = "skip_primitive";
  }

  private resetStringDecoder(): void {
    this.escaped = false;
    this.decodingUnicode = false;
    this.unicode = "";
  }

  /** undefined = escape still incomplete, null = closing quote, string = decoded content. */
  private consumeStringChar(char: string): string | null | undefined {
    if (this.decodingUnicode) {
      this.unicode += char;
      if (this.unicode.length < 4) return undefined;
      if (!/^[0-9A-Fa-f]{4}$/.test(this.unicode)) {
        throw new Error(`Invalid JSON unicode escape: \\u${this.unicode}`);
      }
      const code = Number.parseInt(this.unicode, 16);
      this.decodingUnicode = false;
      this.unicode = "";
      this.escaped = false;
      return String.fromCharCode(code);
    }

    if (this.escaped) {
      if (char === "u") {
        this.decodingUnicode = true;
        this.unicode = "";
        return undefined;
      }
      this.escaped = false;
      const decoded = ESCAPES[char];
      if (decoded === undefined) {
        throw new Error(`Invalid JSON escape: \\${char}`);
      }
      return decoded;
    }

    if (char === "\\") {
      this.escaped = true;
      return undefined;
    }
    if (char === '"') return null;
    if (char.charCodeAt(0) <= 0x1f) {
      throw new Error("Invalid unescaped control character in JSON string");
    }
    return char;
  }
}
