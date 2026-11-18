import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob } = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
}));

vi.mock("../src/providers/provider-policy.js", () => ({
  providerDecision: (provider: string) => ({
    provider,
    enabled: process.env["PROVIDER_ENABLED_" + provider.toUpperCase()] === "true",
    reason: process.env["PROVIDER_ENABLED_" + provider.toUpperCase()] === "true" ? null : "disabled by data policy",
    commercialStatus: "allowed",
    enableFlag: "PROVIDER_ENABLED_" + provider.toUpperCase(),
  }),
  getAssessmentProviderReadiness: () => [
    { provider: "groq", model: "openai/gpt-oss-120b", enabled: process.env.PROVIDER_ENABLED_GROQ === "true", configured: Boolean(process.env.GROQ_API), usable: process.env.PROVIDER_ENABLED_GROQ === "true" && Boolean(process.env.GROQ_API), reason: "disabled_by_data_policy" },
    { provider: "gemini", model: "gemini-2.5-flash", enabled: process.env.PROVIDER_ENABLED_GEMINI === "true", configured: Boolean(process.env.GEMINI_API_KEY), usable: process.env.PROVIDER_ENABLED_GEMINI === "true" && Boolean(process.env.GEMINI_API_KEY), reason: "disabled_by_data_policy" },
    { provider: "ollama", model: "gemma4:31b", enabled: process.env.PROVIDER_ENABLED_OLLAMA === "true", configured: Boolean(process.env.OLLAMA_API_KEY), usable: process.env.PROVIDER_ENABLED_OLLAMA === "true" && Boolean(process.env.OLLAMA_API_KEY), reason: "disabled_by_data_policy" },
  ],
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob }),
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("audit worker provider preflight", () => {
  beforeEach(() => {
    for (const key of ["GROQ_API", "GROQ_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY", "PROVIDER_ENABLED_GROQ", "PROVIDER_ENABLED_GEMINI", "PROVIDER_ENABLED_OLLAMA"]) vi.stubEnv(key, "");
    claimNextQueuedJob.mockReset();
    claimNextQueuedJob.mockResolvedValue({
      id: "provider-preflight-job",
      ownerId: null,
      sourceAudioPath: "fixture/master.wav",
      mimeType: "audio/wav",
      sourceType: "master",
      catalogUrl: null,
      status: "processing",
      claimToken: "11111111-1111-4111-8111-111111111111",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      workerId: "provider-preflight-test",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails before claiming when no assessment provider is usable", async () => {
    await expect(processNextQueuedAudit()).rejects.toThrow("AI_PROVIDERS_UNAVAILABLE");
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
  });

  it("allows claiming when Gemini is usable even when Groq is disabled", async () => {
    vi.stubEnv("PROVIDER_ENABLED_GEMINI", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    claimNextQueuedJob.mockResolvedValueOnce(null);
    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(claimNextQueuedJob).toHaveBeenCalledTimes(1);
  });
});
