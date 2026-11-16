import { describe, expect, it } from "vitest";
import { summarizeProviderFailure } from "../src/providers/provider-error.js";

describe("provider failure diagnostics", () => {
  it("extracts Gemini HTTP status and safe provider code without exposing response text", () => {
    const result = summarizeProviderFailure(new Error(
      'Gemini narrative assessment failed with HTTP 400: {"error":{"code":"INVALID_ARGUMENT","message":"private response detail"}}',
    ));
    expect(result).toEqual({
      provider: "gemini",
      stage: "narrative",
      httpStatus: 400,
      providerCode: "INVALID_ARGUMENT",
      category: "invalid_request",
    });
    expect(JSON.stringify(result)).not.toContain("private response detail");
  });

  it("classifies Gemini JSON validation failures without a raw provider body", () => {
    expect(summarizeProviderFailure(new Error(
      "Gemini positioning response failed Zod validation after one retry: invalid enum",
    ))).toEqual({
      provider: "gemini",
      stage: "positioning",
      httpStatus: null,
      providerCode: null,
      category: "json_validation",
    });
  });

  it("classifies transient Groq capacity failures", () => {
    expect(summarizeProviderFailure(new Error(
      "AI capacity reached for now, please try again later",
    ))).toEqual({
      provider: "unknown",
      stage: null,
      httpStatus: null,
      providerCode: null,
      category: "capacity",
    });
  });
});
