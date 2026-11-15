import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ claimNextQueuedJob: vi.fn() }));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob: mocks.claimNextQueuedJob }),
}));
vi.mock("../src/providers/groq/client.js", () => ({
  GroqClient: class { assess = vi.fn(); },
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("embedded worker provider policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.claimNextQueuedJob.mockReset();
  });

  it("does not claim a queued job when Groq credentials exist but commercial policy is unverified", async () => {
    vi.stubEnv("GROQ_API", "configured");
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "true");
    mocks.claimNextQueuedJob.mockResolvedValue(null);

    await expect(processNextQueuedAudit()).rejects.toThrow("groq: disabled by data policy");
    expect(mocks.claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
