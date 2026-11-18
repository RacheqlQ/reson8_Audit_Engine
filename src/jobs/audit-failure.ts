export interface AuditFailureDetails {
  errorCode: string;
  errorMessage: string;
  provider: "groq" | "gemini" | "ollama" | null;
  model: string | null;
  httpStatus: number | null;
  errorType: string | null;
  retryable: boolean;
}

function safeIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  const safe = value.replace(/[^A-Za-z0-9._:\/-]/g, "").slice(0, 80);
  return safe || null;
}

function providerModel(provider: AuditFailureDetails["provider"], env: Record<string, string | undefined>): string | null {
  if (provider === "groq") return safeIdentifier(env.GROQ_MODEL ?? "openai/gpt-oss-120b");
  if (provider === "gemini") return safeIdentifier(env.GEMINI_MODEL ?? "gemini-3.6-flash");
  if (provider === "ollama") return safeIdentifier(env.OLLAMA_MODEL ?? "gemma4:31b");
  return null;
}

function responseErrorType(message: string): string | null {
  const statusMatch = message.match(/HTTP\s+\d{3}\s*:\s*(\{[\s\S]*\})/i);
  if (!statusMatch) return null;
  try {
    const parsed = JSON.parse(statusMatch[1]) as { error?: { type?: unknown; code?: unknown } };
    const value = typeof parsed.error?.type === "string" ? parsed.error.type
      : typeof parsed.error?.code === "string" ? parsed.error.code : null;
    return safeIdentifier(value);
  } catch {
    return null;
  }
}

/** Extracts only safe provider diagnostics; never persists response bodies, prompts or credentials. */
export function classifyAuditFailure(
  error: unknown,
  providerHint?: AuditFailureDetails["provider"],
  env: Record<string, string | undefined> = process.env,
): AuditFailureDetails {
  const message = error instanceof Error ? error.message : String(error);
  const provider = providerHint
    ?? (/\bgemini\b/i.test(message) ? "gemini" : /\bollama\b/i.test(message) ? "ollama" : /\bgroq\b/i.test(message) ? "groq" : null);
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const retryable = httpStatus !== null
    ? httpStatus === 408 || httpStatus === 409 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500
    : /capacity|timed out|timeout|network|fetch failed|ECONNRESET|ETIMEDOUT|GROQ_ASSESSMENT_TIMEOUT|AUDIT_JOB_DEADLINE_EXCEEDED|GROQ_REQUEST_TOO_LARGE/i.test(message);
  const errorType = responseErrorType(message);
  const model = providerModel(provider, env);
  const errorCode = provider && httpStatus
    ? `${provider.toUpperCase()}_HTTP_${httpStatus}`
    : /GROQ_REQUEST_TOO_LARGE/.test(message) ? "GROQ_REQUEST_TOO_LARGE"
      : /GROQ_ASSESSMENT_TIMEOUT/.test(message) ? "AI_ASSESSMENT_TIMEOUT"
      : /GROQ_PROMPT_BUDGET_EXCEEDED/.test(message) ? "AI_PROMPT_BUDGET_EXCEEDED"
        : errorType ? `AI_PROVIDER_${errorType.toUpperCase()}`
          : provider ? `${provider.toUpperCase()}_PROVIDER_ERROR` : "AUDIT_PROCESSING_FAILED";
  const providerLabel = provider ? provider[0].toUpperCase() + provider.slice(1) : "Audit";
  const statusLabel = httpStatus ? ` HTTP ${httpStatus}` : "";
  const modelLabel = model ? `; model ${model}` : "";
  const safeMessage = provider
    ? `${providerLabel} assessment failed${statusLabel}${modelLabel}; retryable=${retryable}.`
    : `Audit processing failed (${errorCode}); retryable=${retryable}.`;
  return { errorCode, errorMessage: safeMessage, provider, model, httpStatus, errorType, retryable };
}
