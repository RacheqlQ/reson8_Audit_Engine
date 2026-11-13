import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuditEngine } from "../src/main.js";

const engines: Array<{ shutdown(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.shutdown().catch(() => undefined)));
  vi.useRealTimers();
});

describe("shutdown worker-task settlement", () => {
  it("waits for the actual worker task to settle after its shutdown signal", async () => {
    const app = Fastify();
    let workerSettled = false;
    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals: new EventEmitter(),
      runWorker: async (signal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        workerSettled = true;
      },
      onError: (error) => { throw error; },
    });
    engines.push(engine);

    await engine.shutdown();

    expect(workerSettled).toBe(true);
    expect(app.server.listening).toBe(false);
  });

  it("rejects shutdown instead of reporting success when the worker task misses its drain deadline", async () => {
    const app = Fastify();
    const errors: unknown[] = [];
    let workerSettled = false;
    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals: new EventEmitter(),
      runWorker: async () => {
        try {
          await new Promise<void>(() => undefined);
        } finally {
          workerSettled = true;
        }
      },
      onError: (error) => { errors.push(error); },
    });

    vi.useFakeTimers();
    const shutdown = engine.shutdown();
    const outcome = shutdown.then(() => "resolved", () => "rejected");
    await vi.advanceTimersByTimeAsync(24_000);

    expect(await outcome).toBe("rejected");
    await expect(shutdown).rejects.toMatchObject({
      name: "AggregateError",
      message: "Audit engine shutdown did not complete cleanly",
    });
    expect(workerSettled).toBe(false);
    expect(errors.some((error) => error instanceof Error && error.message === "AUDIT_WORKER_DRAIN_TIMEOUT")).toBe(true);
    expect(app.server.listening).toBe(false);
  });
});
