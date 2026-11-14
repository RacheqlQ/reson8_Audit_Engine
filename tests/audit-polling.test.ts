import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditPoller } from "../public/audit-polling.js";
afterEach(() => vi.useRealTimers());
describe("browser audit polling authorization and retry policy", () => {
  it.each([401, 403, 404])("stops immediately on HTTP %i without scheduling another poll", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "denied" }), { status, headers: { "content-type": "application/json" } }));
    const setTimer = vi.fn(() => 1), clearTimer = vi.fn(), onMessage = vi.fn();
    const poller = createAuditPoller({ fetchImpl, setTimer, clearTimer, onMessage });
    await poller.poll("job-1", "capability");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(setTimer).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0][0]).toContain("credential was rejected");
  });
  it("retries transient server responses and continues after a successful queued response", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "temporary" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "queued" }), { status: 200 }));
    const onPayload = vi.fn(), poller = createAuditPoller({ fetchImpl, onPayload });
    await poller.poll("job-1", "capability");
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onPayload).toHaveBeenCalledWith({ status: "queued" });
  });
  it("retries transient network failures", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }));
    const onPayload = vi.fn(), poller = createAuditPoller({ fetchImpl, onPayload });
    await poller.poll("job-1", "capability");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onPayload).toHaveBeenCalledWith({ status: "processing" });
  });
});
