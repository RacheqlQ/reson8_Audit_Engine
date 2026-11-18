import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuditStore } from "../src/integrations/supabase-audit-store.js";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalKey;
});

describe("sanitized audit failure persistence", () => {
  it("stores provider diagnostics in the fenced audit_failed event payload", async () => {
    process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const store = createSupabaseAuditStore();
    const failure = {
      error_code: "AI_PROVIDER_HTTP_400",
      error_message: "Gemini assessment failed with HTTP 400 (invalid_request_error). Model: gemini-2.5-flash.",
      retryable: false,
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      http_status: 400,
      error_type: "invalid_request_error",
      provider_code: "bad_request",
    };

    await store.markFailed("job-1", "claim-1", failure.error_message, undefined, failure);

    expect(requestBody).toMatchObject({
      p_operation: "fail",
      p_payload: {
        message: failure.error_message,
        eventPayload: { failure },
      },
    });
    expect(JSON.stringify(requestBody)).not.toContain("prompt contents");
  });
});
