import { afterEach, describe, expect, it, vi } from "vitest";
import { withAbortTimeout } from "../src/jobs/with-abort-timeout.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("withAbortTimeout", () => {
  it("aborts the in-flight operation and rejects when the timeout expires", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;

    const pending = withAbortTimeout(
      (signal) => {
        receivedSignal = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      1_000,
      "AUDIT_QUEUE_CLAIM_TIMEOUT",
    );

    const assertion = expect(pending).rejects.toThrow("AUDIT_QUEUE_CLAIM_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("returns a successful operation result without aborting its signal", async () => {
    const result = await withAbortTimeout(
      async (signal) => ({ value: "claimed", aborted: signal.aborted }),
      1_000,
      "AUDIT_QUEUE_CLAIM_TIMEOUT",
    );

    expect(result).toEqual({ value: "claimed", aborted: false });
  });

  it("preserves an operation error instead of replacing it with a timeout", async () => {
    await expect(withAbortTimeout(
      async () => { throw new Error("RPC permission denied"); },
      1_000,
      "AUDIT_QUEUE_CLAIM_TIMEOUT",
    )).rejects.toThrow("RPC permission denied");
  });
});
