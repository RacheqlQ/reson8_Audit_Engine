import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runQueueWorkerLoop: vi.fn() }));
vi.mock("../src/jobs/worker-loop.js", () => ({ runQueueWorkerLoop: mocks.runQueueWorkerLoop }));
vi.mock("../src/providers/provider-policy.js", () => ({
  providerDecision: () => ({
    provider: "groq", enabled: false, reason: "disabled by data policy",
    commercialStatus: "allowed", enableFlag: "PROVIDER_ENABLED_GROQ",
  }),
}));

import { runAuditQueueWorker } from "../src/jobs/worker.js";

describe("worker provider preflight", () => {
  it("fails fast without polling when Groq is disabled by data policy", async () => {
    const error = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await runAuditQueueWorker(new AbortController().signal);
    expect(mocks.runQueueWorkerLoop).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain("worker_preflight_blocked");
    error.mockRestore();
  });
});
