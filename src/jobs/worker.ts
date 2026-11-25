import { createAudioDecoder } from "../audio/decoder.js";
import { createRecognitionSample } from "../audio/recognition-sample.js";
import { AuddClient } from "../providers/audd/client.js";
import { getAssessmentProviderReadiness, providerDecision } from "../providers/provider-policy.js";
import { collectCatalogMetadata } from "../providers/dsp/catalog.js";
import { discoverPlaylistCandidates } from "../providers/dsp/playlist-discovery.js";
import { DEFAULT_GROQ_MODEL, GeminiClient, GroqClient, type ProviderAttemptDiagnostic } from "../providers/groq/client.js";
import { ensurePdfReport } from "../reports/pdf-output.js";
import { createSupabaseAuditStore } from "../integrations/supabase-audit-store.js";
import { processAuditJob, type AuditProcessorDependencies } from "./process-audit-job.js";
import { runAssessmentProviderChain } from "./assessment-provider-chain.js";
import { runQueueWorkerLoop } from "./worker-loop.js";
import { withAbortTimeout } from "./with-abort-timeout.js";
import { startRenderFreeServiceKeepalive } from "./render-free-service-keepalive.js";

const POLL_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 45_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const SHUTDOWN_JOB_ABORT_TIMEOUT_MS = 18_000;


export function safeFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/GROQ_PROMPT_BUDGET_EXCEEDED/i.test(message)) return "prompt_budget_exceeded";
  if (/HTTP 402|payment required|insufficient credits|billing required/i.test(message)) return "billing_required";
  if (/capacity|429|daily.limit|TPD/i.test(message)) return "capacity";
  if (/timed out|ETIMEDOUT/i.test(message)) return "timeout";
  if (/json_validate_failed|failed to validate JSON|failed Zod validation/i.test(message)) return "json_validation";
  if (/HTTP 413/i.test(message)) return "request_too_large";
  if (/HTTP 5\d\d|network|fetch failed|ECONNRESET/i.test(message)) return "transient_provider_error";
  if (/HTTP 401|HTTP 403/i.test(message)) return "authentication";
  return "provider_error";
}

export async function processNextQueuedAudit(signal?: AbortSignal): Promise<{ jobId: string; status: "completed" | "failed" } | null> {
  if (signal?.aborted) return null;
  const store = createSupabaseAuditStore();
  if (signal?.aborted) return null;
  // Groq is primary and Gemini is the sole automatic fallback. Ollama billing
  // is intentionally not part of the production assessment chain.
  const readiness = getAssessmentProviderReadiness();
  if (!readiness.some((provider) => (provider.provider === "groq" || provider.provider === "gemini") && provider.usable)) {
    console.error(JSON.stringify({ worker: "audit", event: "provider_chain_unavailable", code: "AI_PROVIDERS_UNAVAILABLE", providers: readiness.map(({ provider, model, reason }) => ({ provider, model, reason })) }));
    throw new Error("AI_PROVIDERS_UNAVAILABLE: no enabled assessment provider has usable credentials");
  }
  const groq = readiness.find((provider) => provider.provider === "groq")?.usable ? new GroqClient() : null;
  const gemini = readiness.find((provider) => provider.provider === "gemini")?.usable ? new GeminiClient() : null;
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
    discoverPlaylists: (input, signal) => discoverPlaylistCandidates(input, {}, signal),
    saveRecognition: async (jobId, _claimToken, recognition, signal) => store.saveRecognition(jobId, _claimToken, recognition, signal),
    saveSonicDna: async (jobId, _claimToken, dna, signal) => store.saveSonicDna(jobId, _claimToken, dna, signal),
    saveEvidence: async (jobId, _claimToken, recognition, reconciliation, metadata, signal, metadataSources) =>
      store.saveEvidence(jobId, _claimToken, recognition, reconciliation, metadata, signal, metadataSources),
    saveCatalogMetadata: async (jobId, _claimToken, metadata, signal) => store.saveCatalogMetadata(jobId, _claimToken, metadata, signal),
    saveCatalogFailure: async (jobId, _claimToken, link, error, signal) =>
      store.saveCatalogFailure(jobId, _claimToken, link, error, signal),
    saveIsrcLookupOutcome: async (jobId, _claimToken, isrc, outcome, signal) =>
      store.saveIsrcLookupOutcome(jobId, _claimToken, isrc, outcome, signal),
    decode: async (bytes, _mimeType, signal) => decoder.decode(bytes, signal),
    generateAssessment: async (input, signal) => {
      const assessmentInput = {
        ...input,
        recordProviderAttempt: (attempt: ProviderAttemptDiagnostic) => store.recordProviderAttempt(job.id, attempt),
        loadCompletedSectionGroup: (group: string, provider: "groq" | "gemini" | "ollama", model: string) => store.loadAssessmentSectionGroup(job.id, group, provider, model),
        saveCompletedSectionGroup: (group: string, result: unknown, provider: "groq" | "gemini" | "ollama", model: string) => store.saveAssessmentSectionGroup(job.id, job.claimToken, group, result, provider, model, signal),
      };
      const providers = [
        { provider: "groq" as const, model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, client: groq },
        { provider: "gemini" as const, model: readiness.find((item) => item.provider === "gemini")?.model ?? "gemini-3.5-flash-lite", client: gemini },
      ];
      return runAssessmentProviderChain(providers, assessmentInput, signal, {
        onSkipped: async (candidate) => {
          const status = readiness.find((item) => item.provider === candidate.provider);
          await store.recordProviderAttempt(job.id, {
            provider: candidate.provider, model: candidate.model, status: null,
            errorType: status?.reason === "daily_capacity" ? "capacity" : status?.reason === "auth_error" ? "auth" : "provider_unavailable",
            retryable: false, attempt: 1,
          });
          console.info(JSON.stringify({ worker: "audit", jobId: job.id, event: "provider_skipped", provider: candidate.provider, model: candidate.model, reason: status?.reason ?? "not_configured" }));
        },
        onFailure: (candidate, error, diagnostic) => {
          console.warn(JSON.stringify({
            worker: "audit", jobId: job.id, event: "provider_fallback",
            provider: candidate.provider, model: candidate.model,
            reason: safeFailureCategory(error), diagnostic,
          }));
        },
      });
    },
    saveAssessment: async (jobId, _claimToken, assessment, signal) => store.saveAssessment(jobId, _claimToken, assessment, signal),
    generateReport: ensurePdfReport,
    saveReport: async (jobId, _claimToken, tier, pdf, reportInput, signal) => store.saveReport(jobId, _claimToken, tier, pdf, reportInput, signal),
    markCompleted: async (jobId, _claimToken, signal) => store.markCompleted(jobId, _claimToken, signal),
    markFailed: async (jobId, _claimToken, message, signal, errorCode) => store.markFailed(jobId, _claimToken, message, signal, errorCode),
    onStageFailure: (diagnostic) => {
      console.error(JSON.stringify({
        worker: "audit",
        jobId: job.id,
        event: "audit_stage_failed",
        ...diagnostic,
      }));
    },
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
    stopOnError: (error) => error instanceof Error && error.message.startsWith("AI_PROVIDERS_UNAVAILABLE"),
  });
}
