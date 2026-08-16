import { describe, expect, test } from "bun:test";
import { jsonValue, parseJsonObject } from "./json";

describe("JSON boundary helpers", () => {
  test("parses object-shaped tool arguments", () => {
    expect(parseJsonObject('{"path":"a.txt","count":2}', "tool args")).toEqual({
      path: "a.txt",
      count: 2,
    });
  });

  test("rejects malformed or non-object tool arguments", () => {
    expect(() => parseJsonObject("{bad", "tool args")).toThrow("invalid JSON");
    expect(() => parseJsonObject("[]", "tool args")).toThrow(
      "must be a JSON object",
    );
  });

  test("rejects non-JSON runtime values", () => {
    expect(() => jsonValue({ createdAt: new Date() }, "payload")).toThrow(
      "not JSON-serializable",
    );
  });
});
