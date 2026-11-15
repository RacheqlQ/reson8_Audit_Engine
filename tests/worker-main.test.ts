import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { startAuditWorkerService } from "../src/worker-main.js";

describe("startAuditWorkerService", () => {
  it("binds the configured health endpoint and drains the queue worker on shutdown", async () => {
    const app = Fastify();
    const signals = new EventEmitter();
    let workerSignal: AbortSignal | undefined;
    const engine = await startAuditWorkerService({
      app,
      host: "127.0.0.1",
      port: 0,
      signals,
      runWorker: async (signal) => {
        workerSignal = signal;
        if (signal.aborted) return;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
    });

    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ status: "ok", service: "reson8-audit-worker" });
    expect(workerSignal).toBeDefined();

    await engine.shutdown();

    expect(workerSignal?.aborted).toBe(true);
    expect(app.server.listening).toBe(false);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });
});
