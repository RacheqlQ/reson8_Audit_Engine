import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAuditQueueWorker: vi.fn(async () => undefined) }));
vi.mock("../src/jobs/worker.js", () => ({ runAuditQueueWorker: mocks.runAuditQueueWorker }));

import { startStandaloneWorker } from "../src/worker-main.js";

describe("standalone worker role guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.runAuditQueueWorker.mockClear();
  });

  it("refuses to start unless the explicit worker role flag is false", async () => {
    vi.stubEnv("RUN_WORKER_IN_API", "true");
    await expect(startStandaloneWorker()).rejects.toThrow("RUN_WORKER_IN_API must be false");
    expect(mocks.runAuditQueueWorker).not.toHaveBeenCalled();
  });

  it("starts the standalone consumer only with the explicit false role flag", async () => {
    vi.stubEnv("RUN_WORKER_IN_API", "false");
    await expect(startStandaloneWorker()).resolves.toBeUndefined();
    expect(mocks.runAuditQueueWorker).toHaveBeenCalledOnce();
  });
});
