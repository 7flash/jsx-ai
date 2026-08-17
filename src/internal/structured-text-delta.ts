type TopLevelState =
  | "before_root"
  | "key"
  | "colon"
  | "value"
  | "nested"
  | "primitive"
  | "after_value"
  | "done";
type StringMode = "key" | "text" | "skip";

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

/**
 * Incrementally exposes one top-level JSON string field without exposing the
 * rest of the structured payload.
 *
 * The model/runtime may stream a JSON object such as:
 *   {"text":"I am reading the file…","toolCalls":[...]}
 *
 * Applications should be able to render the decoded `text` value immediately
 * while tool-call JSON remains private until the complete object validates.
 */
export class StructuredTextDeltaDecoder {
  private state: TopLevelState = "before_root";
  private stringMode: StringMode | undefined;
  private returnState: TopLevelState = "after_value";
  private depth = 0;
  private key = "";
  private currentKey = "";
  private escaped = false;
  private unicode = "";
  private decodingUnicode = false;
  private decodedText = "";

  get text(): string {
    return this.decodedText;
  }

  push(chunk: string): string {
    let visible = "";

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
            this.state = this.returnState;
          }
          continue;
        }

        if (this.stringMode === "key") {
          this.key += decoded;
        } else if (this.stringMode === "text") {
          visible += decoded;
          this.decodedText += decoded;
        }
        continue;
      }

      if (this.state === "done") continue;

      if (this.state === "before_root") {
        if (/\s/.test(char)) continue;
        if (char === "{") {
          this.depth = 1;
          this.state = "key";
        }
        continue;
      }

      if (this.state === "key") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "}") {
          this.depth = 0;
          this.state = "done";
          continue;
        }
        if (char === '"') this.startString("key", "colon");
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
          this.startString(
            this.currentKey === "text" ? "text" : "skip",
            "after_value",
          );
          continue;
        }
        if (char === "{" || char === "[") {
          this.depth++;
          this.state = "nested";
          continue;
        }
        this.state = "primitive";
        if (char === ",") this.state = "key";
        else if (char === "}") this.state = "done";
        continue;
      }

      if (this.state === "nested") {
        if (char === '"') {
          this.startString("skip", "nested");
          continue;
        }
        if (char === "{" || char === "[") {
          this.depth++;
          continue;
        }
        if (char === "}" || char === "]") {
          this.depth--;
          if (this.depth === 1) this.state = "after_value";
        }
        continue;
      }

      if (this.state === "primitive") {
        if (char === "," && this.depth === 1) {
          this.currentKey = "";
          this.state = "key";
        } else if (char === "}" && this.depth === 1) {
          this.depth = 0;
          this.state = "done";
        }
        continue;
      }

      if (this.state === "after_value") {
        if (/\s/.test(char)) continue;
        if (char === ",") {
          this.currentKey = "";
          this.state = "key";
        } else if (char === "}") {
          this.depth = 0;
          this.state = "done";
        }
      }
    }

    return visible;
  }

  private startString(mode: StringMode, returnState: TopLevelState): void {
    this.stringMode = mode;
    this.returnState = returnState;
    this.escaped = false;
    this.decodingUnicode = false;
    this.unicode = "";
    if (mode === "key") this.key = "";
  }

  /** undefined = still consuming escape, null = closing quote, string = decoded content. */
  private consumeStringChar(char: string): string | null | undefined {
    if (this.decodingUnicode) {
      this.unicode += char;
      if (this.unicode.length < 4) return undefined;
      const code = Number.parseInt(this.unicode, 16);
      this.decodingUnicode = false;
      this.unicode = "";
      this.escaped = false;
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    }

    if (this.escaped) {
      if (char === "u") {
        this.decodingUnicode = true;
        this.unicode = "";
        return undefined;
      }
      this.escaped = false;
      return ESCAPES[char] ?? char;
    }

    if (char === "\\") {
      this.escaped = true;
      return undefined;
    }
    if (char === '"') return null;
    return char;
  }
}
