import { describe, expect, it } from "vitest";
import { isFallbackEligible, safeFailureCategory } from "../src/jobs/worker.js";

describe("assessment provider fallback classification", () => {
  it("routes a Groq 413 request-too-large response to the next provider", () => {
    const error = new Error("GROQ_REQUEST_TOO_LARGE: provider rejected the request");
    expect(isFallbackEligible(error)).toBe(true);
    expect(safeFailureCategory(error)).toBe("request_too_large");
  });

  it("does not retry authentication failures against the same provider", () => {
    expect(isFallbackEligible(new Error("Gemini assessment failed with HTTP 401"))).toBe(false);
    expect(safeFailureCategory(new Error("Gemini assessment failed with HTTP 401"))).toBe("authentication");
  });


  it("advances generic Gemini provider errors to the next configured provider", () => {
    expect(isFallbackEligible(new Error("Gemini fallback failed with provider_error"))).toBe(true);
  });

  it("does not advance providers disabled by data policy", () => {
    expect(isFallbackEligible(new Error("groq: disabled by data policy"))).toBe(false);
  });

  it("keeps capacity and transient HTTP failures eligible for fallback", () => {
    expect(isFallbackEligible(new Error("AI capacity reached for now"))).toBe(true);
    expect(isFallbackEligible(new Error("Groq assessment failed with HTTP 503"))).toBe(true);
  });
});
