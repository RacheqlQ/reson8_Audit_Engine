export type ProviderName = "audd" | "spotify" | "tidal";

const MAX_LOG_BYTES = 32_000;

const SENSITIVE_KEYS = new Set([
  "api_token",
  "apiToken",
  "access_token",
  "accessToken",
  "authorization",
  "client_secret",
  "clientSecret",
  "secret",
  "password",
]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) continue;

      if (
        key === "audio" ||
        key === "file" ||
        key === "buffer" ||
        key === "binary"
      ) {
        output[key] = "[redacted-binary]";
        continue;
      }

      output[key] = sanitize(entry);
    }

    return output;
  }

  return value;
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
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);

  console.error(
    JSON.stringify({
      event: "provider_error",
      provider: input.provider,
      operation: input.operation,
      auditJobId: input.auditJobId ?? null,
      error: message,
      timestamp: new Date().toISOString(),
    }),
  );
}
