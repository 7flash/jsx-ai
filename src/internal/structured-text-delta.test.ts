import { describe, expect, it } from "bun:test";
import { StructuredTextDeltaDecoder } from "./structured-text-delta";

describe("StructuredTextDeltaDecoder", () => {
  it("streams only the decoded top-level text field", () => {
    const decoder = new StructuredTextDeltaDecoder();
    const chunks = [
      '{"text":"I\'ll ',
      "inspect\\nthen \\uD83D",
      '\\uDE80","toolCalls":[{"name":"write_file","arguments_json":"{\\"content\\":\\"SECRET\\"}"}]}',
    ];
    const visible = chunks.map((chunk) => decoder.push(chunk)).join("");
    expect(visible).toBe("I'll inspect\nthen 🚀");
    expect(decoder.text).toBe(visible);
    expect(visible).not.toContain("write_file");
    expect(visible).not.toContain("SECRET");
  });

  it("finds text even when another top-level field comes first", () => {
    const decoder = new StructuredTextDeltaDecoder();
    const visible = decoder.push('{"toolCalls":[],"text":"Working now"}');
    expect(visible).toBe("Working now");
  });

  it("handles escaped quotes split across chunks", () => {
    const decoder = new StructuredTextDeltaDecoder();
    expect(decoder.push('{"text":"Say \\')).toBe("Say ");
    expect(decoder.push('"hello\\" now","toolCalls":[]}')).toBe('"hello" now');
    expect(decoder.text).toBe('Say "hello" now');
  });
});
