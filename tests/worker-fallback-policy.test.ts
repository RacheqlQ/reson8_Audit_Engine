import { describe, expect, it } from "vitest";
import { isFallbackEligible } from "../src/jobs/worker.js";

describe("assessment provider fallback policy", () => {
  it("moves to the next provider after authentication and data-policy failures without retrying the same provider", () => {
    expect(isFallbackEligible(new Error("Gemini HTTP 401 unauthorized"))).toBe(true);
    expect(isFallbackEligible(new Error("Groq HTTP 403 disabled by data policy"))).toBe(true);
  });

  it("moves to the next provider for capacity and transient failures", () => {
    expect(isFallbackEligible(new Error("AI capacity reached for now"))).toBe(true);
    expect(isFallbackEligible(new Error("Groq HTTP 429 rate limit"))).toBe(true);
    expect(isFallbackEligible(new Error("Gemini HTTP 503 service unavailable"))).toBe(true);
  });

  it("does not move to another provider after cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isFallbackEligible(new Error("AI capacity reached for now"), controller.signal)).toBe(false);
  });
});
