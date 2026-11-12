import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuditEngine } from "../src/main.js";

const runningEngines: Array<{ shutdown(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(runningEngines.splice(0).map((engine) => engine.shutdown()));
});

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

describe("startAuditEngine", () => {
  it("closes the HTTP listener and drains the embedded worker on repeated signals", async () => {
    const app = Fastify();
    const signals = new EventEmitter();
    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals,
      runWorker: waitForAbort,
      onError: (error) => { throw error; },
    });
    runningEngines.push(engine);

    expect(app.server.listening).toBe(true);
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await engine.shutdown();

    expect(app.server.listening).toBe(false);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });


  it("drains an in-flight HTTP request before shutdown resolves", async () => {
    const app = Fastify();
    let releaseRequest!: () => void;
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
    const blockedResponse = new Promise<void>((resolve) => { releaseRequest = resolve; });

    app.get("/slow", async () => {
      markRequestStarted();
      await blockedResponse;
      return { completed: true };
    });

    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals: new EventEmitter(),
      runWorker: waitForAbort,
      onError: (error) => { throw error; },
    });
    runningEngines.push(engine);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");

    const responsePromise = fetch(`http://127.0.0.1:${address.port}/slow`);
    await requestStarted;
    const shutdownPromise = engine.shutdown();
    let shutdownResolved = false;
    void shutdownPromise.then(() => { shutdownResolved = true; });
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    releaseRequest();
    const [response] = await Promise.all([responsePromise, shutdownPromise]);

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ completed: true });
    expect(app.server.listening).toBe(false);
  });

  it("closes the API listener when the embedded worker fails during startup", async () => {
    const app = Fastify();
    const signals = new EventEmitter();
    let reportWorkerFailure!: () => void;
    const workerFailureReported = new Promise<void>((resolve) => { reportWorkerFailure = resolve; });

    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals,
      runWorker: async () => { throw new Error("worker startup failed"); },
      onError: () => reportWorkerFailure(),
    });
    runningEngines.push(engine);

    await workerFailureReported;
    await engine.shutdown();

    expect(app.server.listening).toBe(false);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("does not start the worker when the HTTP listener cannot start", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");

    const app = Fastify();
    const runWorker = vi.fn(async () => undefined);

    try {
      await expect(startAuditEngine({
        app,
        host: "127.0.0.1",
        port: address.port,
        signals: new EventEmitter(),
        runWorker,
        onError: (error) => { throw error; },
      })).rejects.toBeDefined();

      expect(runWorker).not.toHaveBeenCalled();
      expect(app.server.listening).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    }
  });
  it("bounds graceful worker drain to the 240-second shutdown deadline", async () => {
    const app = Fastify();
    const signals = new EventEmitter();
    const engine = await startAuditEngine({
      app,
      host: "127.0.0.1",
      port: 0,
      signals,
      runWorker: async () => new Promise<void>(() => undefined),
      onError: () => undefined,
    });

    vi.useFakeTimers();
    try {
      const shutdown = engine.shutdown();
      await vi.advanceTimersByTimeAsync(240_000);
      const settled = await Promise.race([
        shutdown.then(() => true, () => true),
        Promise.resolve(false),
      ]);
      expect(settled).toBe(true);
      expect(app.server.listening).toBe(false);
      expect(signals.listenerCount("SIGTERM")).toBe(0);
      expect(signals.listenerCount("SIGINT")).toBe(0);
    } finally {
      vi.useRealTimers();
      signals.removeAllListeners();
    }
  });

});
