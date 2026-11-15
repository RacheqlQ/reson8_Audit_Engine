import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  saveCatalogFailure: vi.fn(),
  processAuditJob: vi.fn(),
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({
    claimNextQueuedJob: mocks.claimNextQueuedJob,
    saveCatalogFailure: mocks.saveCatalogFailure,
    renewLease: vi.fn(),
    markProcessing: vi.fn(),
    downloadMaster: vi.fn(),
    saveRecognition: vi.fn(),
    saveEvidence: vi.fn(),
    saveCatalogMetadata: vi.fn(),
    saveSonicDna: vi.fn(),
    saveAssessment: vi.fn(),
    saveReport: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  }),
}));

vi.mock("../src/providers/groq/client.js", () => ({
  GroqClient: class {
    assess = vi.fn();
  },
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
  const link = {
    platform: "tidal",
    catalogId: "tidal-456",
    canonicalUrl: "https://tidal.com/browse/track/tidal-456",
  };

  beforeEach(() => {
    vi.stubEnv("GROQ_API", "test-groq-key");
    mocks.claimNextQueuedJob.mockReset().mockResolvedValue({
      id: jobId,
      ownerId: null,
      sourceAudioPath: null,
      mimeType: null,
      sourceType: "dsp_link",
      catalogUrl: link.canonicalUrl,
      status: "processing",
      claimToken,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      workerId: "worker-adapter-test",
    });
    mocks.saveCatalogFailure.mockReset().mockResolvedValue(undefined);
    mocks.processAuditJob.mockReset().mockImplementation(async (id, deps) => {
      await deps.saveCatalogFailure?.(id, claimToken, link, "TIDAL returned HTTP 503");
      return { status: "failed" };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the fenced provider-failure persistence operation into the audit processor", async () => {
    await processNextQueuedAudit();

    expect(mocks.saveCatalogFailure).toHaveBeenCalledWith(
      jobId,
      claimToken,
      link,
      "TIDAL returned HTTP 503",
      expect.any(AbortSignal),
    );
  });
});
