export interface AuditFailureDetails {
  error_code: string;
  error_message: string;
  retryable: boolean;
  provider?: "groq" | "gemini" | "ollama" | "tidal";
  model?: string;
  http_status?: number;
  error_type?: string;
  provider_code?: string;
}

const PROVIDERS = new Set(["groq", "gemini", "ollama", "tidal"]);

function boundedIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9_./:-]{1,100}$/.test(normalized) ? normalized : undefined;
}

export function getAuditFailureDetails(error: unknown): AuditFailureDetails {
  const context = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const providerFromMessage = rawMessage.match(/^(Groq|Gemini|Ollama|TIDAL)\b/i)?.[1]?.toLowerCase();
  const providerValue = typeof context.provider === "string" ? context.provider.toLowerCase() : providerFromMessage ?? "";
  const provider = PROVIDERS.has(providerValue) ? providerValue as AuditFailureDetails["provider"] : undefined;
  const model = boundedIdentifier(context.model);
  const messageStatus = rawMessage.match(/HTTP (\d{3})/i)?.[1];
  const httpStatusValue = Number(context.httpStatus ?? messageStatus);
  const httpStatus = Number.isInteger(httpStatusValue) && httpStatusValue >= 100 && httpStatusValue <= 599
    ? httpStatusValue : undefined;
  const errorType = boundedIdentifier(context.providerErrorType);
  const providerCode = boundedIdentifier(context.providerCode);
  const retryable = typeof context.retryable === "boolean"
    ? context.retryable
    : httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)
      || /timed out|timeout|fetch failed|network|ECONNRESET|ETIMEDOUT|GROQ_TPM_CAPACITY_EXHAUSTED|GROQ_ASSESSMENT_TIMEOUT/i.test(rawMessage);

  if (provider) {
    const providerLabel = provider === "gemini" ? "Gemini" : provider === "ollama" ? "Ollama" : provider === "tidal" ? "TIDAL" : "Groq";
    const statusText = httpStatus ? ` with HTTP ${httpStatus}` : "";
    const typeText = errorType ? ` (${errorType})` : "";
    const providerCodePrefix = provider === "tidal" ? "TIDAL_PROVIDER" : "AI_PROVIDER";
    const providerDescription = provider === "tidal" ? "catalog provider" : "assessment";
    const modelText = model ? ` Model: ${model}.` : "";
    return {
      error_code: httpStatus ? `${providerCodePrefix}_HTTP_${httpStatus}` : retryable ? `${providerCodePrefix}_RETRYABLE_FAILURE` : `${providerCodePrefix}_FAILURE`,
      error_message: `${providerLabel} ${providerDescription} failed${statusText}${typeText}.${modelText}`,
      retryable,
      provider,
      ...(model ? { model } : {}),
      ...(httpStatus ? { http_status: httpStatus } : {}),
      ...(errorType ? { error_type: errorType } : {}),
      ...(providerCode ? { provider_code: providerCode } : {}),
    };
  }

  if (/AUDIT_STAGE_TIMEOUT:|GROQ_ASSESSMENT_TIMEOUT|AUDIT_JOB_DEADLINE_EXCEEDED/i.test(rawMessage)) {
    return {
      error_code: /GROQ_ASSESSMENT_TIMEOUT/i.test(rawMessage) ? "AI_ASSESSMENT_TIMEOUT" : "AUDIT_STAGE_TIMEOUT",
      error_message: "A processing stage exceeded its time limit.",
      retryable: true,
    };
  }
  return {
    error_code: "AUDIT_PROCESSING_FAILED",
    error_message: "Audit processing: a required stage could not be completed.",
    retryable,
  };
}
