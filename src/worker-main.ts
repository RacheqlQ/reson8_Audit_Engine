import { runAuditQueueWorker } from "./jobs/worker.js";

if (process.env.RUN_WORKER_IN_API !== "false") {
  console.error(JSON.stringify({
    worker: "audit",
    event: "standalone_worker_blocked",
    reason: "RUN_WORKER_IN_API must be false when the standalone worker owns polling",
  }));
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  void runAuditQueueWorker(controller.signal).catch((error) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "standalone_worker_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
