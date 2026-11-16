import { afterEach, describe, expect, it, vi } from "vitest";
import { startRenderFreeServiceKeepalive } from "../src/jobs/render-free-service-keepalive.js";

afterEach(() => vi.useRealTimers());

describe("embedded worker Render Free keepalive", () => {
  it("sends a low-frequency health request while a claimed job is active", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const stop = startRenderFreeServiceKeepalive({
      enabled: true,
      baseUrl: "https://reson8-audit-engine.onrender.com",
      intervalMs: 60_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://reson8-audit-engine.onrender.com/health");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });

    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not issue requests when disabled or when the public URL is unavailable", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn();
    const stopDisabled = startRenderFreeServiceKeepalive({
      enabled: false,
      baseUrl: "https://reson8-audit-engine.onrender.com",
      intervalMs: 60_000,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const stopWithoutUrl = startRenderFreeServiceKeepalive({
      enabled: true,
      baseUrl: "",
      intervalMs: 60_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchImpl).not.toHaveBeenCalled();
    stopDisabled();
    stopWithoutUrl();
  });
});
