import { runAuditQueueWorker } from "./worker.js";

const controller = new AbortController();
let shutdownStarted = false;

function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  controller.abort(new Error("AUDIT_WORKER_SHUTDOWN"));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void runAuditQueueWorker(controller.signal).catch((error) => {
  console.error(JSON.stringify({
    worker: "audit",
    event: "standalone_worker_failed",
    error: error instanceof Error ? error.message : "Unknown worker failure",
  }));
  process.exitCode = 1;
});
