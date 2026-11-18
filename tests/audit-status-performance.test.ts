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

describe("audit status progress and query profile", () => {
  it("returns furthest persisted stage and failure details with three reads", async () => {
    process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rest/v1/audit_jobs?")) {
        return new Response(JSON.stringify({
          id: "job-1", status: "failed", error_message: "Audit processing failed", catalog_metadata: {},
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rest/v1/audit_events?")) {
        return new Response(JSON.stringify([
          { event_type: "evidence_reconciliation", status: "reconciled", created_at: "2026-11-17T00:21:49.600Z", payload: {} },
          { event_type: "sonic_dna", status: "completed", created_at: "2026-11-17T00:21:49.900Z", payload: {} },
          { event_type: "audit_failed", status: "failed", created_at: "2026-11-17T00:21:52.900Z", payload: { failure: {
            error_code: "AI_PROVIDER_HTTP_400",
            error_message: "Gemini assessment failed with HTTP 400 (invalid_request_error). Model: gemini-2.5-flash.",
            retryable: false, provider: "gemini", model: "gemini-2.5-flash", http_status: 400,
            error_type: "invalid_request_error", provider_code: "bad_request",
          } } },
        ]), { status: 200, headers: { "content-type": "application/json", "content-range": "0-2/3" } });
      }
      if (url.includes("/rest/v1/audit_reports?")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/0" } });
      }
      throw new Error("Unexpected Supabase request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createSupabaseAuditStore();
    const result = await store.getAuditStatus("job-1");

    expect(result.currentStepIndex).toBe(3);
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      error_code: "AI_PROVIDER_HTTP_400",
      provider: "gemini",
      http_status: 400,
      retryable: false,
    });
    expect(result.errorMessage).toContain("Gemini assessment failed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
