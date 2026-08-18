import { describe, expect, it } from "bun:test";
import { StructuredAgentDeltaDecoder } from "./structured-agent-delta";

describe("StructuredAgentDeltaDecoder", () => {
  it("streams visible text and semantic tool-field progress without raw JSON", () => {
    const decoder = new StructuredAgentDeltaDecoder();
    const raw = JSON.stringify({
      text: "I'll update the game.",
      toolCalls: [
        {
          name: "write_file",
          arguments_json: JSON.stringify({
            path: "game.js",
            content: 'const secret = "TOOL_PAYLOAD";\nconsole.log(secret)',
            metadata: { mode: "replace", retries: 2 },
          }),
        },
      ],
    });
    const chunks = [
      raw.slice(0, 18),
      raw.slice(18, 61),
      raw.slice(61, 103),
      raw.slice(103),
    ];
    const text: string[] = [];
    const progress = [];

    for (const chunk of chunks) {
      const next = decoder.push(chunk);
      text.push(next.textDelta);
      progress.push(...next.toolProgress);
    }

    expect(text.join("")).toBe("I'll update the game.");
    expect(progress).toContainEqual({
      type: "tool_detected",
      index: 0,
      name: "write_file",
    });
    expect(progress).toContainEqual({
      type: "field_ready",
      index: 0,
      name: "write_file",
      path: ["path"],
      value: "game.js",
    });
    expect(progress).toContainEqual({
      type: "field_ready",
      index: 0,
      name: "write_file",
      path: ["metadata"],
      value: { mode: "replace", retries: 2 },
    });

    const contentDeltas = progress
      .filter(
        (event) => event.type === "field_delta" && event.path[0] === "content",
      )
      .map((event) => (event.type === "field_delta" ? event.delta : ""))
      .join("");
    expect(contentDeltas).toBe(
      'const secret = "TOOL_PAYLOAD";\nconsole.log(secret)',
    );
    expect(JSON.stringify(progress)).not.toContain("arguments_json");
  });

  it("handles arguments_json before the tool name without losing field progress", () => {
    const decoder = new StructuredAgentDeltaDecoder();
    const args = JSON.stringify({ path: "index.html", content: "hello" });
    const raw = `{"toolCalls":[{"arguments_json":${JSON.stringify(args)},"name":"write_file"}],"text":"done"}`;
    const first = decoder.push(raw.slice(0, raw.indexOf(',"name"')));
    const second = decoder.push(raw.slice(raw.indexOf(',"name"')));

    expect(
      first.toolProgress.some(
        (event) => event.type === "field_ready" && event.path[0] === "path",
      ),
    ).toBe(true);
    expect(
      first.toolProgress.some(
        (event) => "name" in event && event.name !== undefined,
      ),
    ).toBe(false);
    expect(second.toolProgress).toContainEqual({
      type: "tool_detected",
      index: 0,
      name: "write_file",
    });
    expect(first.textDelta + second.textDelta).toBe("done");
  });

  it("keeps nested argument values atomic", () => {
    const decoder = new StructuredAgentDeltaDecoder();
    const raw = JSON.stringify({
      text: "",
      toolCalls: [
        {
          name: "configure",
          arguments_json: JSON.stringify({
            config: { theme: "dark", flags: [true, false] },
          }),
        },
      ],
    });
    const progress = decoder.push(raw).toolProgress;

    expect(progress).toContainEqual({
      type: "field_ready",
      index: 0,
      name: "configure",
      path: ["config"],
      value: { theme: "dark", flags: [true, false] },
    });
    expect(
      progress.some(
        (event) => event.type === "field_delta" && event.path[0] === "config",
      ),
    ).toBe(false);
  });
});
