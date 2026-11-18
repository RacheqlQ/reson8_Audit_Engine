import { createAudioDecoder } from "../audio/decoder.js";
import { createRecognitionSample } from "../audio/recognition-sample.js";
import { AuddClient } from "../providers/audd/client.js";
import { providerDecision } from "../providers/provider-policy.js";
import { collectCatalogMetadata } from "../providers/dsp/catalog.js";
import { DEFAULT_GROQ_MODEL, GeminiClient, GroqClient, OllamaClient } from "../providers/groq/client.js";
import { generateAuditReport } from "../reports/generate-audit-report.js";
import { createSupabaseAuditStore } from "../integrations/supabase-audit-store.js";
import { processAuditJob, type AuditProcessorDependencies } from "./process-audit-job.js";
import { runQueueWorkerLoop } from "./worker-loop.js";
import { withAbortTimeout } from "./with-abort-timeout.js";
import { classifyAuditFailure } from "./audit-failure.js";
import { startRenderFreeServiceKeepalive } from "./render-free-service-keepalive.js";

const POLL_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 45_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const SHUTDOWN_JOB_ABORT_TIMEOUT_MS = 18_000;
let providerUnavailableLogged = false;

export function isFallbackEligible(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /AI capacity reached|timed out|HTTP (?:413|429|5\d\d)|GROQ_REQUEST_TOO_LARGE|GROQ_TPM_CAPACITY_EXHAUSTED|json_validate_failed|failed to validate JSON|failed Zod validation|fetch failed|network|ECONNRESET|ETIMEDOUT|GROQ_ASSESSMENT_TIMEOUT/i.test(message);
}

export function safeFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/capacity|429|daily.limit|TPD/i.test(message)) return "capacity";
  if (/timed out|ETIMEDOUT/i.test(message)) return "timeout";
  if (/json_validate_failed|failed to validate JSON|failed Zod validation/i.test(message)) return "json_validation";
  if (/HTTP 413|GROQ_REQUEST_TOO_LARGE/i.test(message)) return "request_too_large";
  if (/HTTP 5\d\d|network|fetch failed|ECONNRESET/i.test(message)) return "transient_provider_error";
  if (/HTTP 401|HTTP 403/i.test(message)) return "authentication";
  return "provider_error";
}

function providerFailureTelemetry(provider: "groq" | "gemini" | "ollama", model: string, error: unknown) {
  const failure = classifyAuditFailure(error);
  return {
    provider,
    model,
    httpStatus: failure.httpStatus,
    errorType: failure.errorType,
    retryable: failure.retryable,
  };
}

export async function processNextQueuedAudit(signal?: AbortSignal): Promise<{ jobId: string; status: "completed" | "failed" } | null> {
  if (signal?.aborted) return null;
  const store = createSupabaseAuditStore();
  if (signal?.aborted) return null;
  // Only claim work when at least one policy-enabled assessment provider has credentials.
  // A disabled primary provider must not create a noisy 15-second worker failure loop.
  const groqDecision = providerDecision("groq");
  const groq = groqDecision.enabled && (process.env.GROQ_API_KEY || process.env.GROQ_API) ? new GroqClient() : null;
  const geminiDecision = providerDecision("gemini");
  const gemini = geminiDecision.enabled && process.env.GEMINI_API_KEY ? new GeminiClient() : null;
  const ollamaDecision = providerDecision("ollama");
  const ollama = ollamaDecision.enabled && process.env.OLLAMA_API_KEY ? new OllamaClient() : null;
  if (!groq && !gemini && !ollama) {
    if (!providerUnavailableLogged) {
      console.warn(JSON.stringify({
        worker: "audit",
        event: "assessment_provider_chain_unavailable",
        providers: [
          { provider: "groq", enabled: groqDecision.enabled, credentialsConfigured: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API) },
          { provider: "gemini", enabled: geminiDecision.enabled, credentialsConfigured: Boolean(process.env.GEMINI_API_KEY) },
          { provider: "ollama", enabled: ollamaDecision.enabled, credentialsConfigured: Boolean(process.env.OLLAMA_API_KEY) },
        ],
      }));
      providerUnavailableLogged = true;
    }
    return null;
  }
  providerUnavailableLogged = false;
  let job: Awaited<ReturnType<typeof store.claimNextQueuedJob>>;
  try {
    await store.failExpiredProcessingJobs?.();
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
  if (signal?.aborted) {
    console.info(JSON.stringify({
      worker: "audit",
      jobId: job.id,
      event: "claimed_job_deferred_for_shutdown",
    }));
    return null;
  }

  const auddDecision = providerDecision("audd");
  const audd = auddDecision.enabled && (process.env.AUDD_API || process.env.AUDD_API_TOKEN)
    ? new AuddClient() : null;
  const decoder = createAudioDecoder();
  const stopKeepalive = startRenderFreeServiceKeepalive({ jobId: job.id });

  const deps: AuditProcessorDependencies = {
    getJob: async () => ({
      id: job.id,
      ownerId: job.ownerId,
      sourceAudioPath: job.sourceAudioPath,
      mimeType: job.mimeType,
      sourceType: job.sourceType,
      catalogUrl: job.catalogUrl,
      catalogUrls: job.catalogUrls,
      status: "processing",
      claimToken: job.claimToken,
      leaseExpiresAt: job.leaseExpiresAt,
      workerId: job.workerId,
    }),
    markProcessing: async (jobId, claimToken, signal) => store.markProcessing(jobId, claimToken, signal),
    downloadMaster: async (path, signal) => store.downloadMaster(path, signal),
    createRecognitionSample: audd
      ? (master, mimeType, signal) => createRecognitionSample(master, mimeType, undefined, signal)
      : async () => new Uint8Array(),
    recognize: (sample, signal) => audd ? audd.recognize(sample, signal) : Promise.resolve({ matched: false }),
    recognizeUrl: (url, signal) => audd ? audd.recognizeUrl(url, signal) : Promise.resolve({ matched: false }),
    collectCatalogMetadata: (url, signal) => collectCatalogMetadata(url, signal),
    saveRecognition: async (jobId, _claimToken, recognition, signal) => store.saveRecognition(jobId, _claimToken, recognition, signal),
    saveSonicDna: async (jobId, _claimToken, dna, signal) => store.saveSonicDna(jobId, _claimToken, dna, signal),
    saveEvidence: async (jobId, _claimToken, recognition, reconciliation, metadata, signal, metadataSources) =>
      store.saveEvidence(jobId, _claimToken, recognition, reconciliation, metadata, signal, metadataSources),
    saveCatalogMetadata: async (jobId, _claimToken, metadata, signal) => store.saveCatalogMetadata(jobId, _claimToken, metadata, signal),
    saveCatalogFailure: async (jobId, _claimToken, link, error, signal) =>
      store.saveCatalogFailure(jobId, _claimToken, link, error, signal),
    decode: async (bytes, _mimeType, signal) => decoder.decode(bytes, signal),
    generateAssessment: async (input, signal) => {
      const assessmentInput = {
        ...input,
        loadCompletedSectionGroup: (group: string) => store.loadAssessmentSectionGroup(job.id, group),
        saveCompletedSectionGroup: (group: string, result: unknown) => store.saveAssessmentSectionGroup(job.id, job.claimToken, group, result, signal),
      };
      let lastError: unknown;
      if (groq) {
        try {
          return await groq.assess(assessmentInput, signal);
        } catch (error) {
          if (signal?.aborted || !isFallbackEligible(error)) throw error;
          lastError = error;
          if (gemini || ollama) {
            console.warn(JSON.stringify({
              worker: "audit", jobId: job.id, event: gemini ? "groq_fallback_to_gemini" : "groq_fallback_to_ollama",
              reason: safeFailureCategory(error),
              ...providerFailureTelemetry("groq", process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, error),
            }));
          }
        }
      }

      if (gemini && (!groq || !lastError || isFallbackEligible(lastError))) {
        try {
          return await gemini.assess(assessmentInput, signal);
        } catch (geminiError) {
          if (signal?.aborted || !isFallbackEligible(geminiError)) throw geminiError;
          lastError = geminiError;
          console.warn(JSON.stringify({
            worker: "audit", jobId: job.id, event: "gemini_fallback_failed",
            reason: safeFailureCategory(geminiError),
            ...providerFailureTelemetry("gemini", process.env.GEMINI_MODEL ?? "gemini-2.5-flash", geminiError),
          }));
        }
      }

      if (ollama && (!lastError || isFallbackEligible(lastError))) {
        console.warn(JSON.stringify({
          worker: "audit",
          jobId: job.id,
          event: gemini ? "gemini_fallback_to_ollama" : "groq_fallback_to_ollama",
          reason: lastError ? safeFailureCategory(lastError) : "primary_provider_unavailable",
          ...(lastError
            ? providerFailureTelemetry(gemini ? "gemini" : "groq", gemini ? process.env.GEMINI_MODEL ?? "gemini-2.5-flash" : process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, lastError)
            : { provider: "groq", model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, httpStatus: null, errorType: "provider_unavailable", retryable: false }),
        }));
        try {
          return await ollama.assess(assessmentInput, signal);
        } catch (ollamaError) {
          console.error(JSON.stringify({
            worker: "audit", jobId: job.id, event: "ollama_fallback_failed",
            reason: safeFailureCategory(ollamaError),
            ...providerFailureTelemetry("ollama", process.env.OLLAMA_MODEL ?? "gemma4:31b", ollamaError),
          }));
          throw ollamaError;
        }
      }

      if (lastError) throw lastError;
      throw new Error("No assessment provider is ready");
    },
    saveAssessment: async (jobId, _claimToken, assessment, signal) => store.saveAssessment(jobId, _claimToken, assessment, signal),
    generateReport: generateAuditReport,
    saveReport: async (jobId, _claimToken, tier, pdf, reportInput, signal) => store.saveReport(jobId, _claimToken, tier, pdf, reportInput, signal),
    markCompleted: async (jobId, _claimToken, signal) => store.markCompleted(jobId, _claimToken, signal),
    markFailed: async (jobId, _claimToken, message, signal, failure) => store.markFailed(jobId, _claimToken, message, signal, failure),
  };

  const leaseController = new AbortController();
  let shutdownAbortTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatPromise: Promise<void> | null = null;
  let heartbeatStopped = false;
  const heartbeatAbortController = new AbortController();
  let leaseLost: Error | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeatNow = () => {
    heartbeatStopped = true;
    heartbeatAbortController.abort(new Error("AUDIT_HEARTBEAT_STOPPED"));
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };

  const abortActiveJobAfterDrain = () => {
    stopHeartbeatNow();
    if (shutdownAbortTimer) return;
    shutdownAbortTimer = setTimeout(() => {
      leaseController.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    }, SHUTDOWN_JOB_ABORT_TIMEOUT_MS);
    shutdownAbortTimer.unref?.();
  };
  const onShutdown = () => abortActiveJobAfterDrain();
  if (signal?.aborted) onShutdown();
  else signal?.addEventListener("abort", onShutdown, { once: true });

  const heartbeatTick = () => {
    if (heartbeatStopped || heartbeatPromise || leaseLost) return;
    heartbeatPromise = (async () => {
      try {
        await withAbortTimeout(
          (timeoutSignal) => store.renewLease(
            job.id,
            job.claimToken,
            AbortSignal.any([timeoutSignal, heartbeatAbortController.signal]),
          ),
          HEARTBEAT_TIMEOUT_MS,
          "AUDIT_HEARTBEAT_TIMEOUT",
        );
      } catch (error) {
        if (heartbeatStopped) return;
        leaseLost = new Error("AUDIT_LEASE_LOST", { cause: error });
        stopHeartbeatNow();
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
  if (!heartbeatStopped) {
    heartbeat = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
  }

  const stopHeartbeat = async () => {
    stopHeartbeatNow();
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
    stopKeepalive();
    stopHeartbeatNow();
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
