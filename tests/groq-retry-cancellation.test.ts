import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

describe("Groq retry cancellation", () => {
  it("interrupts a long Retry-After delay and does not issue another provider request", async () => {
    const controller = new AbortController();
    const abortReason = new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    let retrySleepStarted!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { retrySleepStarted = resolve; });
    let observedSleepSignal: AbortSignal | undefined;

    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "retry-after": "900" },
      }),
    );
    const sleepImpl = vi.fn((_ms: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      observedSleepSignal = signal;
      retrySleepStarted();
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const client = new GroqClient("test-key", "test-model", fetchImpl as typeof fetch, sleepImpl);
    const pending = client.assess({ evidence: {}, sonicDna: null }, controller.signal);

    await sleepStarted;
    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
    expect(observedSleepSignal).toBe(controller.signal);
    expect(sleepImpl).toHaveBeenCalledWith(900_000, controller.signal);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
