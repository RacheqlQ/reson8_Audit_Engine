import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob, renewLease, observedSignal } = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  renewLease: vi.fn(),
  observedSignal: { current: null as AbortSignal | null },
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob, renewLease }),
}));

vi.mock("../src/jobs/process-audit-job.js", () => ({
  processAuditJob: async (_jobId: string, deps: unknown) => {
    const signal = (deps as { signal?: AbortSignal }).signal;
    observedSignal.current = signal ?? null;
    if (!signal) return new Promise<{ status: "completed" | "failed" }>(() => undefined);
    if (signal.aborted) return { status: "failed" as const };
    return new Promise<{ status: "completed" | "failed" }>((resolve) => {
      signal.addEventListener("abort", () => resolve({ status: "failed" }), { once: true });
    });
  },
}));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("worker heartbeat lease-loss handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("GROQ_API", "test-groq-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    observedSignal.current = null;
    claimNextQueuedJob.mockReset().mockResolvedValue({
      id: "heartbeat-timeout-job",
      ownerId: null,
      sourceAudioPath: "fixture/master.wav",
      mimeType: "audio/wav",
      sourceType: "master",
      catalogUrl: null,
      status: "processing",
      claimToken: "11111111-1111-4111-8111-111111111111",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      workerId: "heartbeat-timeout-test",
    });
    renewLease.mockReset().mockImplementation(() => new Promise<void>(() => undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("times out a stuck lease renewal, aborts active processing, and settles the worker", async () => {
    const processing = processNextQueuedAudit();
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(renewLease).toHaveBeenCalledTimes(1);
    expect(observedSignal.current).toBeInstanceOf(AbortSignal);
    expect(observedSignal.current?.aborted).toBe(true);

    const outcome = await Promise.race([
      processing.then(() => "settled", () => "rejected"),
      Promise.resolve("pending"),
    ]);
    expect(outcome).not.toBe("pending");
  });
});
