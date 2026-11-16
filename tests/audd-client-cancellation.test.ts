import { afterEach, describe, expect, it, vi } from "vitest";
import { AuddClient } from "../src/providers/audd/client.js";

describe("AuddClient cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("aborts an in-flight URL recognition request", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        if (!observedSignal) {
          reject(new Error("AudD request did not receive an AbortSignal"));
          return;
        }
        observedSignal.addEventListener("abort", () => reject(observedSignal?.reason ?? new Error("aborted")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = new AuddClient("test-key").recognizeUrl("https://example.com/preview.mp3", controller.signal);
    await Promise.resolve();
    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));

    await expect(pending).rejects.toThrow("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    expect(observedSignal).toBe(controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
