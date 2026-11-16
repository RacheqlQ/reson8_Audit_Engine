import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { startAuditEngine } from "./main.js";
import { runAuditQueueWorker } from "./jobs/worker.js";

/** Dedicated queue process with a lightweight health endpoint for Render. */
export async function startAuditWorkerService() {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({
    status: "ok",
    service: "reson8-audit-worker",
  }));
  return startAuditEngine({ app, runWorker: runAuditQueueWorker });
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
