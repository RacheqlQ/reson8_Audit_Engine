import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob, providerDecision } = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  providerDecision: vi.fn((provider: string) => ({
    provider,
    enabled: provider === "groq",
    reason: provider === "groq" ? null : "disabled by data policy",
    commercialStatus: provider === "groq" ? "allowed" : "unverified",
    enableFlag: "PROVIDER_ENABLED_GROQ",
  })),
}));

vi.mock("../src/providers/provider-policy.js", () => ({ providerDecision }));
vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob }),
}));

import { processNextQueuedAudit, runAuditQueueWorker } from "../src/jobs/worker.js";
import { ProviderUnavailableError } from "../src/providers/provider-readiness.js";

describe("audit worker provider preflight", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OLLAMA_API_KEY", "");
    providerDecision.mockImplementation((provider: string) => ({
      provider,
      enabled: provider === "groq",
      reason: provider === "groq" ? null : "disabled by data policy",
      commercialStatus: provider === "groq" ? "allowed" : "unverified",
      enableFlag: "PROVIDER_ENABLED_GROQ",
    }));
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

  it("validates that at least one assessment provider is ready before claiming a queued job", async () => {
    const error = await processNextQueuedAudit().catch((value) => value);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).reason).toBe("missing_credentials");
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
  });

  it("continues with Gemini when Groq is disabled but a fallback provider is ready", async () => {
    providerDecision.mockImplementation((provider: string) => ({
      provider,
      enabled: provider === "gemini",
      reason: provider === "gemini" ? null : "disabled by data policy",
      commercialStatus: provider === "gemini" ? "allowed" : "unverified",
      enableFlag: "PROVIDER_ENABLED_GEMINI",
    }));
    vi.stubEnv("GEMINI_API_KEY", "configured");
    claimNextQueuedJob.mockResolvedValueOnce(null);
    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(claimNextQueuedJob).toHaveBeenCalledOnce();
  });

  it("stops worker startup instead of retrying every poll when no assessment provider is ready", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runAuditQueueWorker(new AbortController().signal);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain('"event":"worker_start_blocked"');
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
