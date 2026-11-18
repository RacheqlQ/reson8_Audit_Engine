export interface SanitizedAuditFailure {
  errorCode: string;
  provider: "groq" | "gemini" | "ollama" | null;
  httpStatus: number | null;
  errorType: "capacity" | "timeout" | "request_too_large" | "authentication" | "json_validation" | "provider_error" | "stage_timeout" | "unknown";
  retryable: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

/** Extract only bounded, non-sensitive diagnostics. Never persist raw provider bodies or prompts. */
export function classifyAuditFailure(error: unknown): SanitizedAuditFailure {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const provider = /gemini/i.test(message) ? "gemini"
    : /ollama/i.test(message) ? "ollama"
      : /groq/i.test(message) || /GROQ_/i.test(message) || /AI capacity/i.test(message) ? "groq"
        : null;
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;

  if (/capacity|daily.limit|\bTPM\b|\bTPD\b|429/.test(lower)) {
    return { errorCode: "AI_PROVIDER_CAPACITY", provider, httpStatus: httpStatus ?? 429, errorType: "capacity", retryable: true };
  }
  if (/GROQ_REQUEST_TOO_LARGE|request too large|HTTP\s+413/i.test(message)) {
    return { errorCode: "AI_PROVIDER_REQUEST_TOO_LARGE", provider, httpStatus: httpStatus ?? 413, errorType: "request_too_large", retryable: false };
  }
  if (/GROQ_ASSESSMENT_TIMEOUT|timed out|ETIMEDOUT/i.test(message)) {
    return { errorCode: "AI_PROVIDER_TIMEOUT", provider, httpStatus, errorType: "timeout", retryable: true };
  }
  if (/AUDIT_STAGE_TIMEOUT:/.test(message)) {
    return { errorCode: "AUDIT_STAGE_TIMEOUT", provider: null, httpStatus: null, errorType: "stage_timeout", retryable: true };
  }
  if (/json_validate_failed|failed to validate JSON|failed Zod validation|Zod validation/i.test(message)) {
    return { errorCode: "AI_PROVIDER_JSON_INVALID", provider, httpStatus: httpStatus ?? 400, errorType: "json_validation", retryable: true };
  }
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    return {
      errorCode: `AI_PROVIDER_HTTP_${httpStatus}`,
      provider,
      httpStatus,
      errorType: httpStatus === 401 || httpStatus === 403 ? "authentication" : "provider_error",
      retryable: false,
    };
  }
  if (httpStatus !== null && httpStatus >= 500) {
    return { errorCode: `AI_PROVIDER_HTTP_${httpStatus}`, provider, httpStatus, errorType: "provider_error", retryable: true };
  }
  if (/fetch failed|network|ECONNRESET/i.test(message)) {
    return { errorCode: "AI_PROVIDER_NETWORK_ERROR", provider, httpStatus: null, errorType: "provider_error", retryable: true };
  }
  return { errorCode: "AUDIT_PROCESSING_FAILED", provider, httpStatus, errorType: "unknown", retryable: false };
}
