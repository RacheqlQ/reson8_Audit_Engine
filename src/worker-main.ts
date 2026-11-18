import { runAuditQueueWorker } from "./jobs/worker.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

void runAuditQueueWorker(controller.signal).catch((error) => {
  console.error(JSON.stringify({
    worker: "audit",
    event: "standalone_worker_failed",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
