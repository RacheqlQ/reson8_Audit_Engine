import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  saveCatalogFailure: vi.fn(),
  saveEvidence: vi.fn(),
  processAuditJob: vi.fn(),
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({
    claimNextQueuedJob: mocks.claimNextQueuedJob,
    saveCatalogFailure: mocks.saveCatalogFailure,
    saveEvidence: mocks.saveEvidence,
    renewLease: vi.fn(),
    markProcessing: vi.fn(),
    downloadMaster: vi.fn(),
    saveRecognition: vi.fn(),
    saveCatalogMetadata: vi.fn(),
    saveSonicDna: vi.fn(),
    saveAssessment: vi.fn(),
    saveReport: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    recordProviderAttempt: vi.fn(),
  }),
}));

vi.mock("../src/providers/provider-policy.js", () => ({
  getAssessmentProviderReadiness: () => [
    { provider: "groq", model: "test-groq-model", enabled: true, configured: true, usable: true, reason: null },
    { provider: "gemini", model: "gemini-3.5-flash-lite", enabled: false, configured: false, usable: false, reason: "disabled_by_data_policy" },
    { provider: "ollama", model: "gemma4:31b", enabled: false, configured: false, usable: false, reason: "disabled_by_data_policy" },
  ],
  providerDecision: (id: string) => ({
    provider: id,
    enabled: id === "groq",
    reason: id === "groq" ? null : "disabled by data policy",
    commercialStatus: id === "groq" ? "allowed" : "unverified",
  }),
}));

vi.mock("../src/providers/groq/client.js", () => ({
  DEFAULT_GROQ_MODEL: "test-groq-model",
  GroqClient: class {
    assess = vi.fn();
  },
  GeminiClient: class { assess = vi.fn(); },
  OllamaClient: class { assess = vi.fn(); },
  DEFAULT_GROQ_MODEL: "test-groq-model",
}));

vi.mock("../src/audio/decoder.js", () => ({
  createAudioDecoder: () => ({ decode: vi.fn() }),
}));

vi.mock("../src/jobs/process-audit-job.js", () => ({
  processAuditJob: mocks.processAuditJob,
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("audit worker catalog failure adapter", () => {
  const jobId = "worker-catalog-failure-job";
  const claimToken = "11111111-1111-4111-8111-111111111111";
  const secondUrl = "https://open.spotify.com/track/spotify-789";
  const link = {
    platform: "tidal",
    catalogId: "tidal-456",
    canonicalUrl: "https://tidal.com/browse/track/tidal-456",
  };
  const metadata = { platform: "tidal", title: "Tidal track" };
  const metadataSources = [
    metadata,
    { platform: "deezer", title: "Deezer track" },
  ];
  let observedJob: any;

  beforeEach(() => {
    observedJob = null;
    vi.stubEnv("GROQ_API", "test-groq-key");
    mocks.claimNextQueuedJob.mockReset().mockResolvedValue({
      id: jobId,
      ownerId: null,
      sourceAudioPath: null,
      mimeType: null,
      sourceType: "dsp_link",
      catalogUrl: link.canonicalUrl,
      catalogUrls: [link.canonicalUrl, secondUrl],
      status: "processing",
      claimToken,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      workerId: "worker-adapter-test",
    });
    mocks.saveCatalogFailure.mockReset().mockResolvedValue(undefined);
    mocks.saveEvidence.mockReset().mockResolvedValue(undefined);
    mocks.processAuditJob.mockReset().mockImplementation(async (id, deps) => {
      observedJob = await deps.getJob(id);
      await deps.saveCatalogFailure?.(id, claimToken, link, "TIDAL returned HTTP 503");
      await deps.saveEvidence(id, claimToken, {}, {}, metadata, undefined, metadataSources);
      return { status: "failed" };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes all submitted DSP URLs and metadata provenance through the embedded worker adapter", async () => {
    await processNextQueuedAudit();

    expect(observedJob.catalogUrls).toEqual([link.canonicalUrl, secondUrl]);
    expect(mocks.saveEvidence).toHaveBeenCalledWith(
      jobId,
      claimToken,
      {},
      {},
      metadata,
      undefined,
      metadataSources,
    );
  });

  it("passes the fenced provider-failure persistence operation into the audit processor", async () => {
    await processNextQueuedAudit();

    expect(mocks.saveCatalogFailure).toHaveBeenCalledWith(
      jobId,
      claimToken,
      link,
      "TIDAL returned HTTP 503",
      undefined,
    );
  });
});
