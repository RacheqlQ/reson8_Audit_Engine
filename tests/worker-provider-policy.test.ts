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

  it("allows the worker to preflight Groq only with the exact opt-in flag after owner authorization", async () => {
    vi.stubEnv("GROQ_API", "configured");
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "true");
    mocks.claimNextQueuedJob.mockResolvedValue(null);

    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(mocks.claimNextQueuedJob).toHaveBeenCalledOnce();
  });

  it("idles without claiming a queued job when the Groq opt-in flag is absent or not exactly true", async () => {
    vi.stubEnv("GROQ_API", "configured");
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "TRUE");

    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(mocks.claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
