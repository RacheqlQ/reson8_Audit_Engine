import { createAudioDecoder } from "../audio/decoder.js";
import { createRecognitionSample } from "../audio/recognition-sample.js";
import { AuddClient } from "../providers/audd/client.js";
import { collectCatalogMetadata } from "../providers/dsp/catalog.js";
import { GroqClient } from "../providers/groq/client.js";
import { generateAuditReport } from "../reports/generate-audit-report.js";
import { createSupabaseAuditStore } from "../integrations/supabase-audit-store.js";
import { processAuditJob, type AuditProcessorDependencies } from "./process-audit-job.js";
import { runQueueWorkerLoop } from "./worker-loop.js";
import { withAbortTimeout } from "./with-abort-timeout.js";

const POLL_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 45_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const SHUTDOWN_JOB_ABORT_TIMEOUT_MS = 235_000;

export async function processNextQueuedAudit(signal?: AbortSignal): Promise<{ jobId: string; status: "completed" | "failed" } | null> {
  if (signal?.aborted) return null;
  const store = createSupabaseAuditStore();
  if (signal?.aborted) return null;
  // Validate required provider configuration before claiming work so a
  // misconfigured worker cannot strand a queued job in processing.
  const groq = new GroqClient();
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

  const leaseController = new AbortController();
  let shutdownAbortTimer: ReturnType<typeof setTimeout> | undefined;
  const abortActiveJobAfterDrain = () => {
    if (shutdownAbortTimer) return;
    shutdownAbortTimer = setTimeout(() => {
      leaseController.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    }, SHUTDOWN_JOB_ABORT_TIMEOUT_MS);
    shutdownAbortTimer.unref?.();
  };
  const onShutdown = () => abortActiveJobAfterDrain();
  if (signal?.aborted) onShutdown();
  else signal?.addEventListener("abort", onShutdown, { once: true });
  let heartbeatPromise: Promise<void> | null = null;
  let heartbeatStopped = false;
  let leaseLost: Error | null = null;
  const heartbeatTick = () => {
    if (heartbeatStopped || heartbeatPromise || leaseLost) return;
    heartbeatPromise = (async () => {
      try {
        await withAbortTimeout(
          () => store.renewLease(job.id, job.claimToken),
          HEARTBEAT_TIMEOUT_MS,
          "AUDIT_HEARTBEAT_TIMEOUT",
        );
      } catch (error) {
        leaseLost = new Error("AUDIT_LEASE_LOST", { cause: error });
        leaseController.abort(leaseLost);
        console.error(JSON.stringify({
          worker: "audit",
          jobId: job.id,
          event: "lease_lost",
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
    })().finally(() => { heartbeatPromise = null; });
  };
  const heartbeat = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const stopHeartbeat = async () => {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    if (heartbeatPromise) await heartbeatPromise;
    if (leaseLost) throw leaseLost;
  };
  deps.stopHeartbeat = stopHeartbeat;
  deps.signal = leaseController.signal;

  try {
    const result = await processAuditJob(job.id, deps);
    if (leaseController.signal.aborted) {
      const reason = leaseController.signal.reason;
      throw leaseLost ?? (reason instanceof Error ? reason : new Error("AUDIT_LEASE_LOST"));
    }
    return { jobId: job.id, ...result };
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    if (shutdownAbortTimer) clearTimeout(shutdownAbortTimer);
    signal?.removeEventListener("abort", onShutdown);
    if (heartbeatPromise) await heartbeatPromise;
  }
}

export async function runAuditQueueWorker(signal: AbortSignal): Promise<void> {
  console.log(JSON.stringify({ worker: "audit", status: "started", pollIntervalMs: POLL_INTERVAL_MS }));
  await runQueueWorkerLoop({
    processNext: async () => {
      const result = await processNextQueuedAudit(signal);
      if (result) {
        console.log(JSON.stringify({ worker: "audit", result }));
      }
    },
    signal,
    pollIntervalMs: POLL_INTERVAL_MS,
    onError: (error) => {
      console.error(JSON.stringify({
        worker: "audit",
        event: "worker_cycle_failed",
        retryInMs: POLL_INTERVAL_MS,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  });
}
