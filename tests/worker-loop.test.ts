import { describe, expect, it } from "vitest";
import { runQueueWorkerLoop } from "../src/jobs/worker-loop.js";

describe("runQueueWorkerLoop", () => {
  it("stops polling after its abort signal is raised", async () => {
    const controller = new AbortController();
    const claimed: number[] = [];

    await runQueueWorkerLoop({
      processNext: async () => {
        claimed.push(claimed.length + 1);
        if (claimed.length === 2) controller.abort();
        return null;
      },
      pollIntervalMs: 0,
      signal: controller.signal,
    });

    expect(claimed).toEqual([1, 2]);
  });

  it("continues polling after a transient queue error", async () => {
    const controller = new AbortController();
    const errors: string[] = [];
    let attempts = 0;

    await runQueueWorkerLoop({
      processNext: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary database error");
        controller.abort();
        return null;
      },
      onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
      pollIntervalMs: 0,
      signal: controller.signal,
    });

    expect(attempts).toBe(2);
    expect(errors).toEqual(["temporary database error"]);
  });
});
