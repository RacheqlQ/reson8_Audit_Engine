import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runAuditQueueWorker } from "./jobs/worker.js";

export async function startStandaloneWorker(): Promise<void> {
  if (process.env.RUN_WORKER_IN_API !== "false") {
    throw new Error("RUN_WORKER_IN_API must be false in both the API and standalone worker services before starting a standalone consumer");
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runAuditQueueWorker(controller.signal);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  void startStandaloneWorker().catch((error) => {
    console.error(JSON.stringify({
      worker: "audit",
      event: "standalone_worker_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }));
    process.exitCode = 1;
  });
}
