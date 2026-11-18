import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAssessmentProviderUnavailable,
  getAssessmentProviderReadiness,
  markAssessmentProviderUnavailable,
} from "../src/providers/provider-policy.js";

describe("assessment provider readiness", () => {
  afterEach(() => {
    clearAssessmentProviderUnavailable();
    vi.unstubAllEnvs();
  });

  it("marks authentication failures unavailable while preserving a usable fallback", () => {
    const env = {
      GROQ_API_KEY: "groq-key", GEMINI_API_KEY: "gemini-key", OLLAMA_API_KEY: "",
    };
    markAssessmentProviderUnavailable("groq", "auth_error");
    const readiness = getAssessmentProviderReadiness(env);
    expect(readiness.find((item) => item.provider === "groq")).toMatchObject({ usable: false, reason: "auth_error" });
    expect(readiness.find((item) => item.provider === "gemini")).toMatchObject({ usable: true, reason: null, model: "gemini-3.5-flash-lite" });
  });

  it("marks daily token exhaustion unavailable until the UTC-day expiry", () => {
    const env = { GROQ_API_KEY: "groq-key" };
    markAssessmentProviderUnavailable("groq", "daily_capacity", Date.now() + 60_000);
    expect(getAssessmentProviderReadiness(env).find((item) => item.provider === "groq")).toMatchObject({ usable: false, reason: "daily_capacity" });
  });
});
