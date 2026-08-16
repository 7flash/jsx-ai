import {
  HttpError,
  JsxAiError,
  RequestTimeoutError,
  ResponseParseError,
  TransportError,
} from "../errors";
import { abortReason } from "./errors";

export interface RequestOptions {
  apiKey?: string;
  /** Per-attempt timeout. Non-streaming calls include body parsing; streams cover connection/headers. Default: 60s. */
  timeoutMs?: number;
  /** Number of retries after the first attempt. Default: 3. */
  retries?: number;
  /** Optional external cancellation signal. */
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface RequestPolicy {
  retries: number;
  timeoutMs: number;
  externalSignal?: AbortSignal;
}

function requestPolicy(options?: RequestOptions): RequestPolicy {
  const retries = options?.retries ?? 3;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `retries must be a non-negative integer; received ${retries}`,
    );
  }

  const timeoutMs = options?.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `timeoutMs must be a finite positive number; received ${timeoutMs}`,
    );
  }

  return {
    retries,
    timeoutMs,
    ...(options?.signal ? { externalSignal: options.signal } : {}),
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(1000 * 2 ** attempt, 10_000);
}

/**
 * The timeout controller is cleared once response headers arrive for streams,
 * while the combined signal remains linked to the caller's external signal.
 */
function attemptSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new RequestTimeoutError(timeoutMs)),
    timeoutMs,
  );

  return {
    signal: external
      ? AbortSignal.any([external, timeoutController.signal])
      : timeoutController.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeAttemptError(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted && signal.reason instanceof RequestTimeoutError) {
    return signal.reason;
  }
  return error;
}

async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
  label: string,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const policy = requestPolicy(options);

  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    if (policy.externalSignal?.aborted)
      throw abortReason(policy.externalSignal);
    const attemptAbort = attemptSignal(policy.timeoutMs, policy.externalSignal);

    try {
      const response = await fetch(url, {
        ...init,
        signal: attemptAbort.signal,
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < policy.retries) {
        const delay = retryDelayMs(response, attempt);
        await response.body?.cancel().catch(() => undefined);
        attemptAbort.cleanup();
        await sleep(delay, policy.externalSignal);
        continue;
      }
      return await consume(response);
    } catch (caught) {
      const error = normalizeAttemptError(caught, attemptAbort.signal);
      if (error instanceof HttpError || error instanceof ResponseParseError)
        throw error;
      if (policy.externalSignal?.aborted)
        throw abortReason(policy.externalSignal);
      if (attempt === policy.retries) {
        if (error instanceof RequestTimeoutError) throw error;
        throw new TransportError(label, error);
      }
      await sleep(Math.min(1000 * 2 ** attempt, 10_000), policy.externalSignal);
    } finally {
      attemptAbort.cleanup();
    }
  }

  throw new TransportError(label, new Error("unreachable retry state"));
}

async function requireOk(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;
  throw new HttpError(label, response.status, await response.text());
}

export async function requestJson(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
  label: string,
): Promise<unknown> {
  return requestWithRetry(url, init, options, label, async (response) => {
    await requireOk(response, label);
    try {
      const data: unknown = await response.json();
      return data;
    } catch (error) {
      throw new ResponseParseError(label, error);
    }
  });
}

export async function requestStream(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
  label: string,
): Promise<Response> {
  return requestWithRetry(url, init, options, label, (response) =>
    requireOk(response, label),
  );
}

function ssePayload(block: string): string | undefined {
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line === "data") {
      data.push("");
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (data.length === 0) return undefined;
  return data.join("\n");
}

function nextEventBoundary(
  buffer: string,
): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : undefined;
}

function parseSseEvent(
  block: string,
  extractText: (event: unknown) => string,
): string | undefined {
  const payload = ssePayload(block);
  if (payload === undefined || payload === "" || payload === "[DONE]")
    return undefined;

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    throw new SyntaxError(
      `Invalid JSON in SSE data event: ${payload.slice(0, 200)}`,
      { cause: error },
    );
  }
  const text = extractText(event);
  return text || undefined;
}

/** Parse standards-compliant SSE event blocks, including multi-line data fields and a final unterminated event. */
export async function* parseSSEStream(
  response: Response,
  extractText: (event: unknown) => string,
): AsyncGenerator<string> {
  if (!response.body) throw new Error("Streaming response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = nextEventBoundary(buffer);
    while (boundary) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const text = parseSseEvent(block, extractText);
      if (text) yield text;
      boundary = nextEventBoundary(buffer);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const text = parseSseEvent(buffer, extractText);
    if (text) yield text;
  }
}
