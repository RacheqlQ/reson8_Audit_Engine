import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditPoller } from "../public/audit-polling.js";
afterEach(() => vi.useRealTimers());
describe("browser audit polling authorization and retry policy", () => {
  it.each([401, 403])("stops immediately on HTTP %i without scheduling another poll", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "denied" }), { status, headers: { "content-type": "application/json" } }));
    const setTimer = vi.fn(() => 1), clearTimer = vi.fn(), onMessage = vi.fn();
    const poller = createAuditPoller({ fetchImpl, setTimer, clearTimer, onMessage });
    await poller.poll("job-1", "capability");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(setTimer).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0][0]).toContain("credential was rejected");
  });
  it("stops after three consecutive 404 responses and shows the invalid-key message", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 }));
    const onMessage = vi.fn();
    const poller = createAuditPoller({ fetchImpl, onMessage, retryDelayMs: 100 });
    await poller.poll("job-1", "capability");
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onMessage).toHaveBeenCalledWith("Invalid key or report not found for this audit");
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("resets the consecutive 404 count after a successful response", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const onMessage = vi.fn(), poller = createAuditPoller({ fetchImpl, onMessage, retryDelayMs: 100 });
    await poller.poll("job-1", "capability");
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onMessage).not.toHaveBeenCalled();
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
  it("continues polling after the long-running notice instead of going idle", async () => {
    vi.useFakeTimers();
    let requests = 0;
    const fetchImpl = vi.fn(async () => {
      requests++;
      const completed = requests >= 4;
      return new Response(JSON.stringify({ status: completed ? "completed" : "processing", full: { available: completed } }), { status: 200 });
    });
    const onMessage = vi.fn();
    const poller = createAuditPoller({ fetchImpl, onMessage, maxWaitMs: 1000, retryDelayMs: 500 });
    await poller.poll("job-long-running", "capability");
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0][0]).toContain("status checks will continue");
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
