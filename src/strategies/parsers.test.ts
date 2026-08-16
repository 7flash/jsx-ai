import { describe, expect, test } from "bun:test";
import type { ExtractedPrompt } from "../types";
import { parseNLTToolCalls } from "./nlt";
import { buildXMLDocument, parseXMLToolCalls, unescapeXml } from "./xml";

const prompt: ExtractedPrompt = {
  tools: [
    {
      name: "write_file",
      description: "Write <file> & preserve text",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path" },
          content: { type: "string", description: "Body" },
        },
        required: ["filePath", "content"],
      },
    },
  ],
  messages: [],
  system: "Use x < y && y > 0",
};

describe("NLT parser", () => {
  test("accepts bullets, lowercase yes, camelCase params, and multiline values", () => {
    const calls = parseNLTToolCalls(
      `
- write_file – yes
PARAM filePath: src/game.js
PARAM content: const x = 1;
path: this is code, not a parameter
const y = 2;
Assessment finished.
`,
      prompt,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write_file");
    expect(calls[0].args.filePath).toBe("src/game.js");
    expect(calls[0].args.content).toContain("path: this is code");
  });
});

describe("XML strategy", () => {
  test("escapes system text and attributes", () => {
    const xml = buildXMLDocument(prompt);
    expect(xml).toContain("Use x &lt; y &amp;&amp; y &gt; 0");
    expect(xml).toContain("Write &lt;file&gt; &amp; preserve text");
  });

  test("unescapes parsed parameters and supports CDATA", () => {
    const calls = parseXMLToolCalls(
      `<response><tool_calls><call tool="write_file"><param name="content"><![CDATA[if (x < y) a &= b;]]></param><param name="filePath">src/a&amp;b.ts</param></call></tool_calls></response>`,
    );
    expect(calls[0].args.content).toBe("if (x < y) a &= b;");
    expect(calls[0].args.filePath).toBe("src/a&b.ts");
    expect(unescapeXml("&lt;&amp;&gt;")).toBe("<&>");
  });
});
