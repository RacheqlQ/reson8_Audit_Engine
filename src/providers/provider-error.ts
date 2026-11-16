export interface ProviderFailureSummary {
  provider: "groq" | "gemini" | "unknown";
  stage: string | null;
  httpStatus: number | null;
  providerCode: string | null;
  category: "authentication" | "rate_limit" | "invalid_request" | "json_validation" | "timeout" | "capacity" | "network" | "server" | "validation" | "unknown";
}

/**
 * Produce actionable provider diagnostics without logging response bodies,
 * prompts, credentials, or other potentially sensitive provider content.
 */
export function summarizeProviderFailure(error: unknown): ProviderFailureSummary {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = /^(Groq|Gemini)\s+([a-z-]+)\s+/i.exec(message);
  const provider = prefix?.[1]?.toLowerCase() === "groq"
    ? "groq"
    : prefix?.[1]?.toLowerCase() === "gemini" ? "gemini" : "unknown";
  const stage = prefix?.[2] ?? null;
  const statusMatch = /assessment failed with HTTP (\d{3})/i.exec(message);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  let providerCode: string | null = null;
  const bodyStart = message.indexOf("{", statusMatch?.index ?? -1);
  if (bodyStart >= 0) {
    try {
      const payload = JSON.parse(message.slice(bodyStart)) as {
        error?: { code?: unknown; status?: unknown };
      };
      const rawCode = payload.error?.code ?? payload.error?.status;
      if (typeof rawCode === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode)) {
        providerCode = rawCode;
      }
    } catch {
      // Provider body is deliberately not logged when it cannot be parsed.
    }
  }

  let category: ProviderFailureSummary["category"] = "unknown";
  if (/capacity reached|daily cap/i.test(message)) category = "capacity";
  else if (/timed out|timeout|DEADLINE_EXCEEDED/i.test(message)) category = "timeout";
  else if (/fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(message)) category = "network";
  else if (/Zod validation|JSON validation|json_validate_failed/i.test(message) || providerCode === "json_validate_failed") category = "json_validation";
  else if (httpStatus === 401 || httpStatus === 403) category = "authentication";
  else if (httpStatus === 429) category = "rate_limit";
  else if (httpStatus !== null && httpStatus >= 500) category = "server";
  else if (httpStatus === 400 || httpStatus === 404 || httpStatus === 422) category = "invalid_request";
  else if (/validation/i.test(message)) category = "validation";

  return { provider, stage, httpStatus, providerCode, category };
}
