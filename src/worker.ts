import { createServer } from "node:http";
import { runAuditQueueWorker } from "./jobs/worker.js";

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 10000);
  const host = process.env.HOST ?? "0.0.0.0";
  const controller = new AbortController();

  const healthServer = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(302, { location: "https://reson8-audit-engine.onrender.com/" });
      response.end();
      return;
    }

    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "reson8-audit-worker" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  });

  const stop = () => {
    controller.abort();
    healthServer.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  healthServer.listen(port, host, () => {
    console.log(JSON.stringify({ worker: "audit", status: "health-listening", port, host }));
  });

  runAuditQueueWorker(controller.signal).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
