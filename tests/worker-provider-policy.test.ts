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

  it("allows the worker to preflight Groq when credentials are configured without an enable flag", async () => {
    vi.stubEnv("GROQ_API", "configured");
    mocks.claimNextQueuedJob.mockResolvedValue(null);

    await expect(processNextQueuedAudit()).resolves.toBeNull();
    expect(mocks.claimNextQueuedJob).toHaveBeenCalledOnce();
  });

  it("does not claim a queued job when no assessment provider credentials are configured", async () => {
    vi.stubEnv("GROQ_API", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OLLAMA_API_KEY", "");

    await expect(processNextQueuedAudit()).rejects.toThrow("AI_PROVIDERS_UNAVAILABLE");
    expect(mocks.claimNextQueuedJob).not.toHaveBeenCalled();
  });
});
