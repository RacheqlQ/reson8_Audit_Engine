import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

describe("Groq assessment deadline", () => {
  it("aborts a long provider Retry-After wait within the overall assessment deadline", async () => {
    let observedSleepSignal: AbortSignal | undefined;
    let signalRetryWaitStarted!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { signalRetryWaitStarted = resolve; });
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "rate limited" } }),
      { status: 429, headers: { "retry-after": "900" } },
    ));
    const sleepImpl = vi.fn((_ms: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      observedSleepSignal = signal;
      signalRetryWaitStarted();
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const client = new GroqClient("test-key", "test-model", fetchImpl as typeof fetch, sleepImpl, 90_000, 10);
    const pending = client.assess({ evidence: {}, sonicDna: null });
    await sleepStarted;
    await expect(pending).rejects.toThrow("GROQ_ASSESSMENT_TIMEOUT");

    expect(observedSleepSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
