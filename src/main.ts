import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { runAuditQueueWorker } from "./jobs/worker.js";
import { withAbortTimeout } from "./jobs/with-abort-timeout.js";

type ShutdownSignal = "SIGTERM" | "SIGINT";

const WORKER_DRAIN_TIMEOUT_MS = 240_000;

interface SignalSource {
  on(event: ShutdownSignal, listener: () => void): unknown;
  off(event: ShutdownSignal, listener: () => void): unknown;
}

type WorkerRunner = (signal: AbortSignal) => Promise<void>;

export interface StartAuditEngineOptions {
  app?: FastifyInstance;
  port?: number;
  host?: string;
  runWorker?: WorkerRunner;
  signals?: SignalSource;
  onError?: (error: unknown) => void;
}

export interface RunningAuditEngine {
  app: FastifyInstance;
  shutdown(): Promise<void>;
}

/**
 * Starts the HTTP API and its single embedded queue consumer.
 * Importing this module is side-effect-free; only the executable entrypoint starts it.
 */
export async function startAuditEngine(
  options: StartAuditEngineOptions = {},
): Promise<RunningAuditEngine> {
  const app = options.app ?? buildServer();
  const port = options.port ?? Number(process.env.PORT ?? 10000);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const runWorker = options.runWorker ?? runAuditQueueWorker;
  const signals = options.signals ?? process;
  const reportError = options.onError ?? ((error: unknown) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "application_shutdown_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });

  const controller = new AbortController();

  try {
    await app.listen({ port, host });
  } catch (error) {
    if (app.server.listening) {
      await app.close().catch(reportError);
    }
    throw error;
  }

  let workerTask: Promise<void>;
  let shutdownTask: Promise<void> | null = null;

  const shutdown = (): Promise<void> => {
    if (shutdownTask) return shutdownTask;

    // Stop the next poll immediately; an already-claimed job is allowed to finish.
    controller.abort();
    shutdownTask = (async () => {
      const closeHttp = app.server.listening ? app.close() : Promise.resolve();
      const drainWorker = withAbortTimeout(
        async () => {
          await workerTask;
        },
        WORKER_DRAIN_TIMEOUT_MS,
        "AUDIT_WORKER_DRAIN_TIMEOUT",
      ).catch((error) => {
        reportError(error);
      });
      const outcomes = await Promise.allSettled([closeHttp, drainWorker]);
      signals.off("SIGTERM", onSigterm);
      signals.off("SIGINT", onSigint);

      const failures = outcomes
        .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
        .map((outcome) => outcome.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Audit engine shutdown did not complete cleanly");
      }
    })();
    return shutdownTask;
  };

  const onSigterm = () => {
    void shutdown().catch(reportError);
  };
  const onSigint = () => {
    void shutdown().catch(reportError);
  };

  signals.on("SIGTERM", onSigterm);
  signals.on("SIGINT", onSigint);

  workerTask = Promise.resolve().then(() => runWorker(controller.signal));
  workerTask.catch((error) => {
    reportError(error);
    void shutdown().catch(reportError);
  });

  return { app, shutdown };
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  void startAuditEngine().catch((error) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "startup_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
