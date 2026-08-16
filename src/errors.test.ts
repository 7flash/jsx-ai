import { describe, expect, test } from "bun:test";
import {
  HttpError,
  JsxAiError,
  RequestTimeoutError,
  ResponseParseError,
  TransportError,
  isJsxAiError,
} from "./errors";

describe("public error contract", () => {
  test("exposes stable error codes and preserves causes", () => {
    const cause = new Error("socket closed");
    const transport = new TransportError("provider request", cause);
    expect(isJsxAiError(transport, "NETWORK_ERROR")).toBe(true);
    expect(transport.cause).toBe(cause);

    const parse = new ResponseParseError("provider request", cause);
    expect(parse.code).toBe("INVALID_RESPONSE");
    expect(parse.cause).toBe(cause);
  });

  test("specialized errors retain useful structured fields", () => {
    const http = new HttpError("provider request", 429, "rate limited");
    expect(http).toBeInstanceOf(JsxAiError);
    expect(http.code).toBe("HTTP_ERROR");
    expect(http.status).toBe(429);
    expect(http.responseBody).toBe("rate limited");

    const timeout = new RequestTimeoutError(250);
    expect(timeout.code).toBe("REQUEST_TIMEOUT");
    expect(timeout.timeoutMs).toBe(250);
  });
});
