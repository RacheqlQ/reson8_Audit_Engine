import { describe, expect, it } from "vitest";
import { getAuditFailureDetails } from "../src/jobs/failure-details.js";

describe("sanitized audit failure details", () => {
  it("extracts provider diagnostics without persisting raw provider bodies", () => {
    const error = Object.assign(new Error(
      'Gemini narrative assessment failed with HTTP 400: {"error":{"type":"invalid_request_error","code":"bad_request","message":"private prompt and credential material"}}',
    ), {
      provider: "gemini",
      model: "gemini-2.5-flash",
      httpStatus: 400,
      providerErrorType: "invalid_request_error",
      providerCode: "bad_request",
      retryable: false,
    });

    const details = getAuditFailureDetails(error);
    expect(details).toMatchObject({
      error_code: "AI_PROVIDER_HTTP_400",
      provider: "gemini",
      model: "gemini-2.5-flash",
      http_status: 400,
      error_type: "invalid_request_error",
      retryable: false,
    });
    expect(details.error_message).not.toContain("private prompt");
    expect(details.error_message).not.toContain("credential");
  });

  it("marks rate limits and TPM capacity exhaustion as retryable", () => {
    const error = Object.assign(new Error("Groq evidence-score assessment failed with HTTP 429"), {
      provider: "groq",
      model: "openai/gpt-oss-120b",
      httpStatus: 429,
      providerErrorType: "rate_limit_error",
      retryable: true,
    });

    expect(getAuditFailureDetails(error)).toMatchObject({
      error_code: "AI_PROVIDER_HTTP_429",
      provider: "groq",
      http_status: 429,
      retryable: true,
    });
  });
});
