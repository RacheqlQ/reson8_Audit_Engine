import { createServer } from "node:http";
import { createAudioDecoder } from "../audio/decoder.js";
import { createRecognitionSample } from "../audio/recognition-sample.js";
import { AuddClient } from "../providers/audd/client.js";
import { collectCatalogMetadata } from "../providers/dsp/catalog.js";
import { GroqClient } from "../providers/groq/client.js";
import { generateAuditReport } from "../reports/generate-audit-report.js";
import { createSupabaseAuditStore } from "../integrations/supabase-audit-store.js";
import { processAuditJob, type AuditProcessorDependencies } from "./process-audit-job.js";

const POLL_INTERVAL_MS = 15_000;

export async function processNextQueuedAudit(): Promise<{ jobId: string; status: "completed" | "failed" } | null> {
  const store = createSupabaseAuditStore();
  let job: Awaited<ReturnType<typeof store.claimNextQueuedJob>>;
  try {
    job = await store.claimNextQueuedJob();
  } catch (error) {
    console.error(JSON.stringify({
      worker: "audit",
      event: "queue_claim_failed",
      retryInMs: POLL_INTERVAL_MS,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  if (!job) return null;

  const audd = process.env.AUDD_API || process.env.AUDD_API_TOKEN ? new AuddClient() : null;
  const decoder = createAudioDecoder();
  const groq = new GroqClient();

  const deps: AuditProcessorDependencies = {
    getJob: async () => ({
      id: job.id,
      ownerId: job.ownerId,
      sourceAudioPath: job.sourceAudioPath,
      mimeType: job.mimeType,
      sourceType: job.sourceType,
      catalogUrl: job.catalogUrl,
      status: "processing",
      claimToken: job.claimToken,
      leaseExpiresAt: job.leaseExpiresAt,
      workerId: job.workerId,
    }),
    markProcessing: async (jobId, claimToken) => store.markProcessing(jobId, claimToken),
    downloadMaster: async (path) => store.downloadMaster(path),
    createRecognitionSample: audd ? createRecognitionSample : async () => new Uint8Array(),
    recognize: (sample) => audd ? audd.recognize(sample) : Promise.resolve({ matched: false }),
    recognizeUrl: (url) => audd ? audd.recognizeUrl(url) : Promise.resolve({ matched: false }),
    collectCatalogMetadata,
    saveRecognition: async (jobId, _claimToken, recognition) => store.saveRecognition(jobId, _claimToken, recognition),
    saveSonicDna: async (jobId, _claimToken, dna) => store.saveSonicDna(jobId, _claimToken, dna),
    saveEvidence: async (jobId, _claimToken, recognition, reconciliation, metadata) =>
      store.saveEvidence(jobId, _claimToken, recognition, reconciliation, metadata),
    saveCatalogMetadata: async (jobId, _claimToken, metadata) => store.saveCatalogMetadata(jobId, _claimToken, metadata),
    decode: async (bytes) => decoder.decode(bytes),
    generateAssessment: (input) => groq.assess(input),
    saveAssessment: async (jobId, _claimToken, assessment) => store.saveAssessment(jobId, _claimToken, assessment),
    generateReport: generateAuditReport,
    saveReport: async (jobId, _claimToken, tier, pdf, reportInput) => store.saveReport(jobId, _claimToken, tier, pdf, reportInput),
    markCompleted: async (jobId, _claimToken) => store.markCompleted(jobId, _claimToken),
    markFailed: async (jobId, _claimToken, message) => store.markFailed(jobId, _claimToken, message),
  };

  let heartbeatPromise: Promise<void> | null = null;
  let heartbeatStopped = false;
  let leaseLost: Error | null = null;
  const heartbeatTick = () => {
    if (heartbeatStopped || heartbeatPromise || leaseLost) return;
    heartbeatPromise = (async () => {
      try {
        await store.renewLease(job.id, job.claimToken);
      } catch (error) {
        leaseLost = error instanceof Error ? error : new Error(String(error));
        console.error(JSON.stringify({ worker: "audit", jobId: job.id, event: "lease_lost" }));
      }
    })().finally(() => { heartbeatPromise = null; });
  };
  const heartbeat = setInterval(heartbeatTick, 45_000);
  heartbeat.unref();

  const stopHeartbeat = async () => {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    if (heartbeatPromise) await heartbeatPromise;
    if (leaseLost) throw new Error("AUDIT_LEASE_LOST");
  };
  deps.stopHeartbeat = stopHeartbeat;

  try {
    const result = await processAuditJob(job.id, deps);
    return { jobId: job.id, ...result };
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    if (heartbeatPromise) await heartbeatPromise;
  }
}

function startHealthServer(): void {
  const port = Number(process.env.PORT ?? 10000);
  const host = process.env.HOST ?? "0.0.0.0";

  createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(302, { location: "https://reson8-audit-engine.onrender.com/" });
      response.end();
      return;
    }

    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        service: "reson8-audit-worker",
      }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  }).listen(port, host, () => {
    console.log(JSON.stringify({ worker: "audit", status: "health-listening", port, host }));
  });
}

async function runWorkerLoop(): Promise<void> {
  startHealthServer();
  console.log(JSON.stringify({ worker: "audit", status: "started", pollIntervalMs: POLL_INTERVAL_MS }));

  for (;;) {
    try {
      const result = await processNextQueuedAudit();
      console.log(JSON.stringify({ worker: "audit", result }));
    } catch (error) {
      console.error(JSON.stringify({
        worker: "audit",
        event: "worker_cycle_failed",
        retryInMs: POLL_INTERVAL_MS,
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (process.env.NODE_ENV !== "test") {
  runWorkerLoop().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
