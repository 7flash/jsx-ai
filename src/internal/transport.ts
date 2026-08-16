import { abortReason, errorMessage } from "./errors";

export interface RequestOptions {
  apiKey?: string;
  /** Per-attempt timeout. Non-streaming calls include body parsing; streams cover connection/headers. Default: 60s. */
  timeoutMs?: number;
  /** Number of retries after the first attempt. Default: 3. */
  retries?: number;
  /** Optional external cancellation signal. */
  signal?: AbortSignal;
}

export class HttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(label: string, status: number, responseBody: string) {
    super(`${label} failed (${status}): ${responseBody.slice(0, 500)}`);
    this.name = "HttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

class ResponseParseError extends Error {
  constructor(label: string, cause: unknown) {
    super(`${label} returned an invalid JSON response`, { cause });
    this.name = "ResponseParseError";
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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

function attemptSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(external?.reason);

  if (external?.aborted) controller.abort(external.reason);
  else external?.addEventListener("abort", abortFromExternal, { once: true });

  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", abortFromExternal);
    },
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

async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const retries = Math.max(0, options?.retries ?? 3);
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 60_000);
  const externalSignal = options?.signal;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (externalSignal?.aborted) throw abortReason(externalSignal);
    const attemptAbort = attemptSignal(timeoutMs, externalSignal);
    try {
      const response = await fetch(url, {
        ...init,
        signal: attemptAbort.signal,
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        const delay = retryDelayMs(response, attempt);
        await response.body?.cancel().catch(() => undefined);
        attemptAbort.cleanup();
        await sleep(delay, externalSignal);
        continue;
      }
      return await consume(response);
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError || error instanceof ResponseParseError)
        throw error;
      if (externalSignal?.aborted) throw abortReason(externalSignal);
      if (attempt === retries) throw error;
      await sleep(Math.min(1000 * 2 ** attempt, 10_000), externalSignal);
    } finally {
      attemptAbort.cleanup();
    }
  }

  throw new Error(`Request retries exhausted: ${errorMessage(lastError)}`);
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
  return requestWithRetry(url, init, options, async (response) => {
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
  return requestWithRetry(url, init, options, (response) =>
    requireOk(response, label),
  );
}

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
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

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
      if (text) yield text;
    }
  }
}
