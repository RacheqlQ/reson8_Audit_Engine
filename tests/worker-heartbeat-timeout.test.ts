import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextQueuedJob, renewLease, observedSignal, processAuditJob } = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  renewLease: vi.fn(),
  observedSignal: { current: null as AbortSignal | null },
  processAuditJob: vi.fn(async (_jobId: string, deps: unknown) => {
    const signal = (deps as { signal?: AbortSignal }).signal;
    observedSignal.current = signal ?? null;
    if (!signal) return new Promise<{ status: "completed" | "failed" }>(() => undefined);
    if (signal.aborted) return { status: "failed" as const };
    return new Promise<{ status: "completed" | "failed" }>((resolve) => {
      signal.addEventListener("abort", () => resolve({ status: "failed" }), { once: true });
    });
  }),
}));

vi.mock("../src/integrations/supabase-audit-store.js", () => ({
  createSupabaseAuditStore: () => ({ claimNextQueuedJob, renewLease }),
}));

vi.mock("../src/jobs/process-audit-job.js", () => ({ processAuditJob }));

import { processNextQueuedAudit } from "../src/jobs/worker.js";

describe("worker heartbeat lease-loss handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("GROQ_API", "test-groq-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    observedSignal.current = null;
    processAuditJob.mockClear();
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
    const processingAssertion = expect(processing).rejects.toThrow("AUDIT_LEASE_LOST");
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await processingAssertion;

    expect(renewLease).toHaveBeenCalledTimes(1);
    expect(observedSignal.current).toBeInstanceOf(AbortSignal);
    expect(observedSignal.current?.aborted).toBe(true);
  });
  it("stops renewing immediately and aborts active work within 18 seconds of shutdown", async () => {
    renewLease.mockImplementation(() => Promise.resolve());
    const shutdown = new AbortController();
    const processing = processNextQueuedAudit(shutdown.signal);
    const outcome = processing.then(() => "resolved", () => "rejected");

    await Promise.resolve();
    await Promise.resolve();
    expect(observedSignal.current).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(40_000);
    shutdown.abort();
    await vi.advanceTimersByTimeAsync(18_000);

    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("rejected");
    expect(renewLease).not.toHaveBeenCalled();
    expect(observedSignal.current?.aborted).toBe(true);
  });

  it("does not start a job claimed after shutdown begins during the claim request", async () => {
    processAuditJob.mockImplementation(async () => ({ status: "completed" }));
    let resolveClaim!: (value: unknown) => void;
    claimNextQueuedJob.mockImplementationOnce(() => new Promise((resolve) => {
      resolveClaim = resolve;
    }));

    const shutdown = new AbortController();
    const processing = processNextQueuedAudit(shutdown.signal);
    expect(claimNextQueuedJob).toHaveBeenCalledTimes(1);

    shutdown.abort();
    resolveClaim({
      id: "claimed-during-shutdown",
      ownerId: null,
      sourceAudioPath: "fixture/master.wav",
      mimeType: "audio/wav",
      sourceType: "master",
      catalogUrl: null,
      status: "processing",
      claimToken: "11111111-1111-4111-8111-111111111111",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      workerId: "shutdown-claim-test",
    });

    await processing;
    expect(processAuditJob).not.toHaveBeenCalled();
  });

});
