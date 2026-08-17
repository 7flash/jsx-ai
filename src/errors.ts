export type JsxAiErrorCode =
  | "INVALID_ARGUMENT"
  | "UNKNOWN_PROVIDER"
  | "UNKNOWN_STRATEGY"
  | "MISSING_API_KEY"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "REQUEST_TIMEOUT"
  | "NETWORK_ERROR"
  | "ABORTED"
  | "UNSUPPORTED_CAPABILITY"
  | "MISSING_RUNTIME_DEPENDENCY"
  | "RUNTIME_ERROR";

/** Stable base error for failures originating inside jsx-ai. */
export class JsxAiError extends Error {
  readonly code: JsxAiErrorCode;

  constructor(code: JsxAiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JsxAiError";
    this.code = code;
  }
}

/** Non-2xx HTTP response from an LLM provider. */
export class HttpError extends JsxAiError {
  readonly status: number;
  readonly responseBody: string;

  constructor(label: string, status: number, responseBody: string) {
    super(
      "HTTP_ERROR",
      `${label} failed (${status}): ${responseBody.slice(0, 500)}`,
    );
    this.name = "HttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Provider returned a body that could not be decoded as the expected response type. */
export class ResponseParseError extends JsxAiError {
  constructor(label: string, cause: unknown) {
    super("INVALID_RESPONSE", `${label} returned an invalid JSON response`, {
      cause,
    });
    this.name = "ResponseParseError";
  }
}

/** One HTTP attempt exceeded its configured timeout. */
export class RequestTimeoutError extends JsxAiError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("REQUEST_TIMEOUT", `Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Network/transport failure after retry policy has been exhausted. */
export class TransportError extends JsxAiError {
  constructor(label: string, cause: unknown) {
    super(
      "NETWORK_ERROR",
      `${label} failed after exhausting its retry policy`,
      { cause },
    );
    this.name = "TransportError";
  }
}

export function isJsxAiError(
  error: unknown,
  code?: JsxAiErrorCode,
): error is JsxAiError {
  return (
    error instanceof JsxAiError && (code === undefined || error.code === code)
  );
}
