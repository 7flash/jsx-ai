import { JsxAiError } from "../errors";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof JsxAiError) return error.code;
  if (!error || typeof error !== "object" || !("code" in error))
    return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (reason !== undefined)
    return new JsxAiError("ABORTED", `Aborted: ${errorMessage(reason)}`);
  return new JsxAiError("ABORTED", "Aborted");
}
