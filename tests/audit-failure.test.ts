import { describe, expect, it } from "vitest";
import { classifyAuditFailure } from "../src/jobs/audit-failure.js";

describe("sanitized audit failure classification", () => {
  it("records provider, HTTP status, and retryability without retaining provider response text", () => {
    const result = classifyAuditFailure(new Error(
      "Gemini narrative assessment failed with HTTP 503: private response body and API token",
    ));

    expect(result).toEqual({
      errorCode: "AI_PROVIDER_HTTP_503",
      provider: "gemini",
      httpStatus: 503,
      errorType: "provider_error",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private response body");
    expect(JSON.stringify(result)).not.toContain("API token");
  });

  it("classifies provider authentication failures as non-retryable", () => {
    expect(classifyAuditFailure(new Error("Ollama assessment failed with HTTP 401"))).toMatchObject({
      errorCode: "AI_PROVIDER_HTTP_401",
      provider: "ollama",
      httpStatus: 401,
      retryable: false,
    });
  });

  it("classifies capacity and request timeouts as retryable without exposing raw errors", () => {
    expect(classifyAuditFailure(new Error("AI capacity reached for now"))).toMatchObject({
      errorCode: "AI_PROVIDER_CAPACITY",
      retryable: true,
    });
    expect(classifyAuditFailure(new Error("GROQ_ASSESSMENT_TIMEOUT"))).toMatchObject({
      errorCode: "AI_PROVIDER_TIMEOUT",
      provider: "groq",
      retryable: true,
    });
  });

  it("treats a request-too-large response as non-retryable for the same provider", () => {
    expect(classifyAuditFailure(new Error("GROQ_REQUEST_TOO_LARGE: provider rejected the request"))).toMatchObject({
      errorCode: "AI_PROVIDER_REQUEST_TOO_LARGE",
      provider: "groq",
      retryable: false,
    });
  });
});
