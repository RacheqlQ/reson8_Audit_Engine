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
    delete process.env.GROQ_API;
    delete process.env.GROQ_MODEL;
    delete process.env.PROVIDER_ENABLED_GROQ;
    mocks.claimNextQueuedJob.mockReset();
  });

  it("does not claim a queued job when Groq credentials exist but commercial policy is unverified", async () => {
    process.env.GROQ_API = "configured";
    process.env.PROVIDER_ENABLED_GROQ = "true";
    mocks.claimNextQueuedJob.mockResolvedValue(null);

    await expect(processNextQueuedAudit()).rejects.toThrow("groq: disabled by data policy");
    expect(mocks.claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
