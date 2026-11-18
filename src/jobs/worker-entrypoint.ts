import { runAuditQueueWorker } from "./worker.js";
import { classifyAuditFailure } from "./audit-failure.js";

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
  const failure = classifyAuditFailure(error);
  console.error(JSON.stringify({
    worker: "audit",
    event: "standalone_worker_failed",
    errorCode: failure.errorCode,
    provider: failure.provider,
    httpStatus: failure.httpStatus,
    errorType: failure.errorType,
    retryable: failure.retryable,
  }));
  process.exitCode = 1;
});
