import "./server.js";
import { runAuditQueueWorker } from "./jobs/worker.js";

const controller = new AbortController();
const stop = () => controller.abort();

process.once("SIGTERM", stop);
process.once("SIGINT", stop);

runAuditQueueWorker(controller.signal).catch((error) => {
  console.error(JSON.stringify({
    worker: "audit",
    event: "embedded_worker_stopped",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
