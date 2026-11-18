export type ProviderName = "audd" | "spotify" | "tidal";

const MAX_LOG_BYTES = 32_000;

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|secret|password|credential)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\\bBearer\\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\\b(?:AIza[0-9A-Za-z_-]{20,}|AQ\\.[A-Za-z0-9._-]{10,}|gsk_[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{10,})\\b/g,
  /((?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\\s*[:=]\\s*["']?)[^"'\\s,}]+/gi,
];

function sanitizeText(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce((safe, pattern) => safe.replace(pattern, "$1[redacted]"), value)
    .replace(/\\bBearer\\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[redacted]";
        continue;
      }

      if (/^(?:audio|file|buffer|binary)$/i.test(key)) {
        output[key] = "[redacted-binary]";
        continue;
      }

      output[key] = sanitize(entry);
    }

    return output;
  }

  return typeof value === "string" ? sanitizeText(value) : value;
}

function truncate(value: string): string {
  if (value.length <= MAX_LOG_BYTES) return value;
  return `${value.slice(0, MAX_LOG_BYTES)}…[truncated]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return JSON.stringify({
      serializationError: true,
      type: typeof value,
    });
  }
}

export function logProviderResponse(input: {
  provider: ProviderName;
  operation: string;
  status: number;
  ok: boolean;
  payload: unknown;
  auditJobId?: string;
}): void {
  console.log(
    JSON.stringify({
      event: "provider_response",
      provider: input.provider,
      operation: input.operation,
      auditJobId: input.auditJobId ?? null,
      httpStatus: input.status,
      ok: input.ok,
      payload: truncate(safeJson(input.payload)),
      timestamp: new Date().toISOString(),
    }),
  );
}

export function logProviderFailure(input: {
  provider: ProviderName;
  operation: string;
  error: unknown;
  auditJobId?: string;
}): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const statusMatch = message.match(/\\bHTTP\\s+(\\d{3})\\b/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const errorCategory = /401|403|unauthorized|forbidden/i.test(message) ? "authentication"
    : /429|capacity|rate.limit/i.test(message) ? "capacity"
      : /timed out|timeout|ETIMEDOUT/i.test(message) ? "timeout"
        : httpStatus !== null && httpStatus >= 500 ? "transient_provider_error" : "provider_error";

  console.error(
    JSON.stringify({
      event: "provider_error",
      provider: input.provider,
      operation: input.operation,
      auditJobId: input.auditJobId ?? null,
      httpStatus,
      errorType: input.error instanceof Error ? input.error.name : "UnknownError",
      errorCategory,
      timestamp: new Date().toISOString(),
    }),
  );
}
