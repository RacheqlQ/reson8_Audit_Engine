import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob } = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob }),
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("audit worker provider preflight", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API", "");
    vi.stubEnv("GROQ_API_KEY", "");
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

  it("validates Groq configuration before claiming a queued job", async () => {
    await expect(processNextQueuedAudit()).rejects.toThrow("GROQ_API is required");
    expect(claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
