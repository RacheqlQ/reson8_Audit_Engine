import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob } = vi.hoisted(() => ({ claimNextQueuedJob: vi.fn() }));

vi.mock("../src/providers/provider-policy.js", () => ({
  providerDecision: (provider: string) => ({ provider, enabled: true, reason: null, commercialStatus: "allowed" }),
  getAssessmentProviderReadiness: () => [
    { provider: "groq", model: "openai/gpt-oss-120b", enabled: true, configured: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API), usable: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API), reason: process.env.GROQ_API_KEY || process.env.GROQ_API ? null : "not_configured" },
    { provider: "gemini", model: "gemini-3.5-flash-lite", enabled: true, configured: Boolean(process.env.GEMINI_API_KEY), usable: Boolean(process.env.GEMINI_API_KEY), reason: process.env.GEMINI_API_KEY ? null : "not_configured" },
    { provider: "ollama", model: "gemma4:31b", enabled: true, configured: Boolean(process.env.OLLAMA_API_KEY), usable: Boolean(process.env.OLLAMA_API_KEY), reason: process.env.OLLAMA_API_KEY ? null : "not_configured" },
  ],
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob }),
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("audit worker provider preflight", () => {
  beforeEach(() => {
    for (const key of ["GROQ_API", "GROQ_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY"]) vi.stubEnv(key, "");
    claimNextQueuedJob.mockReset();
    claimNextQueuedJob.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("fails before claiming when no assessment provider credentials are configured", async () => {
    await expect(processNextQueuedAudit()).rejects.toThrow("AI_PROVIDERS_UNAVAILABLE");
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
  });

  it("does not treat Ollama credentials as an approved automatic assessment fallback", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key");
    await expect(processNextQueuedAudit()).rejects.toThrow("AI_PROVIDERS_UNAVAILABLE");
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
  });

  it("allows claiming when Gemini credentials are configured without any provider enable flag", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(claimNextQueuedJob).toHaveBeenCalledTimes(1);
  });
});
