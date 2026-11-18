import { describe, expect, it } from "vitest";
import { classifyAuditFailure } from "../src/jobs/audit-failure.js";

describe("classifyAuditFailure", () => {
  it("records Gemini HTTP diagnostics without retaining provider response content", () => {
    const result = classifyAuditFailure(
      new Error('Gemini narrative assessment failed with HTTP 403: {"error":{"type":"permission_denied","message":"secret prompt and API_KEY=do-not-store"}}'),
      undefined,
      { GEMINI_MODEL: "gemini-2.5-flash" },
    );
    expect(result).toMatchObject({
      errorCode: "GEMINI_HTTP_403",
      provider: "gemini",
      model: "gemini-2.5-flash",
      httpStatus: 403,
      errorType: "permission_denied",
      retryable: false,
    });
    expect(result.errorMessage).toContain("HTTP 403");
    expect(JSON.stringify(result)).not.toContain("secret prompt");
    expect(JSON.stringify(result)).not.toContain("do-not-store");
  });

  it("classifies provider capacity and HTTP 429 as retryable", () => {
    const result = classifyAuditFailure(
      new Error("Groq narrative assessment failed with HTTP 429: {\\\"error\\\":{\\\"type\\\":\\\"rate_limit\\\"}}"),
    );
    expect(result).toMatchObject({
      errorCode: "GROQ_HTTP_429",
      provider: "groq",
      httpStatus: 429,
      retryable: true,
    });
  });

  it("does not treat authentication failures as retryable", () => {
    const result = classifyAuditFailure(new Error("Gemini narrative assessment failed with HTTP 401"));
    expect(result.retryable).toBe(false);
  });
});
