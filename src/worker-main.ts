import Fastify, { type FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runAuditQueueWorker } from "./jobs/worker.js";
import { withAbortTimeout } from "./jobs/with-abort-timeout.js";

type ShutdownSignal = "SIGTERM" | "SIGINT";

interface SignalSource {
  on(event: ShutdownSignal, listener: () => void): unknown;
  off(event: ShutdownSignal, listener: () => void): unknown;
}

type WorkerRunner = (signal: AbortSignal) => Promise<void>;

export interface StartAuditWorkerServiceOptions {
  app?: FastifyInstance;
  port?: number;
  host?: string;
  runWorker?: WorkerRunner;
  signals?: SignalSource;
  onError?: (error: unknown) => void;
}

export interface RunningAuditWorkerService {
  app: FastifyInstance;
  shutdown(): Promise<void>;
}

/** Starts a health-checked HTTP shell around the dedicated queue consumer. */
export async function startAuditWorkerService(
  options: StartAuditWorkerServiceOptions = {},
): Promise<RunningAuditWorkerService> {
  const app = options.app ?? Fastify({ logger: true });
  const port = options.port ?? Number(process.env.PORT ?? 10000);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const runWorker = options.runWorker ?? runAuditQueueWorker;
  const signals = options.signals ?? process;
  const reportError = options.onError ?? ((error: unknown) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "worker_service_shutdown_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "reson8-audit-worker",
  }));

  await app.listen({ port, host });

  const controller = new AbortController();
  let workerTask: Promise<void>;
  let shutdownTask: Promise<void> | null = null;

  const shutdown = (): Promise<void> => {
    if (shutdownTask) return shutdownTask;
    controller.abort();
    shutdownTask = (async () => {
      const closeHttp = app.server.listening
        ? withAbortTimeout(
          async () => { await app.close(); },
          24_000,
          "AUDIT_WORKER_HTTP_CLOSE_TIMEOUT",
        )
        : Promise.resolve();
      const drainWorker = withAbortTimeout(
        async () => { await workerTask; },
        24_000,
        "AUDIT_WORKER_DRAIN_TIMEOUT",
      );
      const outcomes = await Promise.allSettled([closeHttp, drainWorker]);
      signals.off("SIGTERM", onSigterm);
      signals.off("SIGINT", onSigint);
      const failures = outcomes
        .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
        .map((outcome) => outcome.reason);
      if (failures.length) {
        throw new AggregateError(failures, "Audit worker service shutdown did not complete cleanly");
      }
    })();
    return shutdownTask;
  };

  const onSigterm = () => { void shutdown().catch(reportError); };
  const onSigint = () => { void shutdown().catch(reportError); };
  signals.on("SIGTERM", onSigterm);
  signals.on("SIGINT", onSigint);

  workerTask = Promise.resolve().then(() => runWorker(controller.signal));
  workerTask.catch(() => {
    void shutdown().catch(reportError);
  });

  return { app, shutdown };
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  void startAuditWorkerService().catch((error) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "worker_service_startup_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
