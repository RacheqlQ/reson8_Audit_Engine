import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreateAuditJobDependencies } from "../jobs/create-audit-job.js";
import type { AuditJobRecord } from "../jobs/process-audit-job.js";
import type { AuditRecognition } from "../providers/audd/normalize.js";
import { type CatalogMetadata } from "../providers/dsp/catalog.js";
import type { MetadataReconciliation } from "../metadata/ReconciliationEngine.js";
import type { SonicDnaFeatures } from "../audio/sonic-dna.js";
import { DEFAULT_GROQ_MODEL, GROQ_PROMPT_VERSION, type ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
import { ensurePdfReport, isPdf } from "../reports/pdf-output.js";
import { sha256 } from "../jobs/content-hash.js";
import { withAbortTimeout } from "../jobs/with-abort-timeout.js";
import { persistUploadedReport } from "../jobs/report-persistence.js";

export interface SupabaseAuditStore {
  admin: SupabaseClient;
  createJobDependencies(): CreateAuditJobDependencies;
  claimNextQueuedJob(): Promise<AuditJobRecord | null>;
  renewLease(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markProcessing(jobId: string, claimToken: string): Promise<void>;
  downloadMaster(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  saveRecognition(jobId: string, claimToken: string, recognition: AuditRecognition, signal?: AbortSignal): Promise<void>;
  saveEvidence(jobId: string, claimToken: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  saveCatalogMetadata(jobId: string, claimToken: string, metadata: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  saveSonicDna(jobId: string, claimToken: string, dna: SonicDnaFeatures, signal?: AbortSignal): Promise<void>;
  saveAssessment(jobId: string, claimToken: string, assessment: ArAssessment, signal?: AbortSignal): Promise<void>;
  saveReport(jobId: string, claimToken: string, tier: AuditReportTier, pdf: Uint8Array, reportInput?: AuditReportInput, signal?: AbortSignal): Promise<void>;
  markCompleted(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markFailed(jobId: string, claimToken: string, message: string, signal?: AbortSignal): Promise<void>;
  getAuditStatus(jobId: string): Promise<{
    jobId: string;
    status: "queued" | "processing" | "completed" | "failed";
    currentStepIndex: number;
    errorMessage?: string | null;
    full: { available: boolean; version?: number };
  }>;
  getAuditReport(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
    filename: string;
  }>;
  getAuditReportPayload(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<unknown | null>;
}

export function createSupabaseAuditStore(
  url = process.env.SUPABASE_URL,
  secretKey = process.env.SUPABASE_SECRET_KEY,
): SupabaseAuditStore {
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is required");

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });


  const fencedStep = async (jobId: string, claimToken: string, operation: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    let request = admin.rpc("persist_fenced_audit_step", {
      p_job_id: jobId, p_claim_token: claimToken, p_operation: operation, p_payload: payload,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) {
      if (error.message.includes("AUDIT_LEASE_LOST") || error.code === "P0001") {
        throw new Error("AUDIT_LEASE_LOST");
      }
      throw new Error(`Unable to persist fenced ${operation}: ${error.message}`);
    }
    return data as Record<string, unknown> | null;
  };
  const readAuditReportPayload = async (jobId: string): Promise<unknown | null> => {
    const { data, error } = await admin.from("audit_events")
      .select("payload")
      .eq("audit_job_id", jobId)
      .eq("event_type", "report_generated")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Unable to read audit report payload: ${error.message}`);
    for (const event of data ?? []) {
      const payload = event.payload as Record<string, unknown> | null;
      if (payload && payload.reportInput) return payload.reportInput;
    }
    return null;
  };


  return {
    admin,
    createJobDependencies() {
      return {
        createJob: async (input) => {
          const { data, error } = await admin.from("audit_jobs").insert({
            owner_id: input.ownerId, status: "queued", original_filename: input.filename,
            mime_type: input.mimeType, size_bytes: input.sizeBytes, sha256: input.sha256,
          }).select("id").single();
          if (error || !data) throw new Error(`Unable to create audit job: ${error?.message ?? "unknown error"}`);
          return data.id as string;
        },
        createCatalogJob: async (input) => {
          const { data, error } = await admin.from("audit_jobs").insert({
            owner_id: input.ownerId, status: "queued", source_type: "dsp_link",
            catalog_url: input.catalogUrl, sha256: input.sha256,
          }).select("id").single();
          if (error || !data) throw new Error(`Unable to create catalog audit job: ${error?.message ?? "unknown error"}`);
          return data.id as string;
        },
        uploadMaster: async (path, bytes, mimeType) => {
          const { error } = await admin.storage.from("audit-audio").upload(path, bytes, { contentType: mimeType, upsert: false });
          if (error) throw new Error(`Unable to store audio master: ${error.message}`);
        },
        setSourcePath: async (jobId, path) => {
          const { error } = await admin.from("audit_jobs").update({ source_audio_path: path }).eq("id", jobId);
          if (error) throw new Error(`Unable to finalize audit job: ${error.message}`);
        },
        deleteMaster: async (path) => {
          const { error } = await admin.storage.from("audit-audio").remove([path]);
          if (error) throw new Error(`Unable to clean up audio master: ${error.message}`);
        },
        deleteJob: async (jobId) => {
          const { error } = await admin.from("audit_jobs").delete().eq("id", jobId);
          if (error) throw new Error(`Unable to clean up audit job: ${error.message}`);
        },
      };
    },
    async claimNextQueuedJob() {
      const workerId = `audit-worker:${process.env.RENDER_INSTANCE_ID ?? process.env.HOSTNAME ?? "local"}:${randomUUID()}`;
      const { data, error } = await withAbortTimeout(
        (signal) => Promise.resolve(admin.rpc("claim_next_audit_job", {
          p_worker_id: workerId, p_lease_seconds: 180,
        }).abortSignal(signal)),
        12_000,
        "AUDIT_QUEUE_CLAIM_TIMEOUT",
      );
      if (error) throw new Error(`Unable to atomically claim audit job: ${error.message}`);
      const claimed = Array.isArray(data) ? data[0] : data;
      if (!claimed) return null;
      if (!claimed.claim_token || !claimed.lease_expires_at) {
        throw new Error("Atomic claim RPC returned a job without a lease token");
      }
      return {
        id: claimed.id as string,
        ownerId: claimed.owner_id as string | null,
        sourceAudioPath: claimed.source_audio_path as string | null,
        mimeType: claimed.mime_type as string | null,
        sourceType: (claimed.source_type ?? "master") as "master" | "dsp_link",
        catalogUrl: claimed.catalog_url as string | null,
        status: "processing" as const,
        claimToken: claimed.claim_token as string,
        leaseExpiresAt: claimed.lease_expires_at as string,
        workerId: claimed.worker_id as string,
      };
    },
    async renewLease(jobId, claimToken, signal) {
      let request = admin.rpc("renew_audit_job_lease", {
        p_job_id: jobId, p_claim_token: claimToken, p_lease_seconds: 180,
      });
      if (signal) request = request.abortSignal(signal);
      const { error } = await request;
      if (error) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("AUDIT_HEARTBEAT_ABORTED");
        throw new Error(error.message.includes("AUDIT_LEASE_LOST") ? "AUDIT_LEASE_LOST" : `Unable to renew audit lease: ${error.message}`);
      }
    },
    async markProcessing(jobId, claimToken) {
      await fencedStep(jobId, claimToken, "processing_started", {}, signal);
    },
    async downloadMaster(path, signal) {
      signal?.throwIfAborted();
      const { data, error } = await admin.storage.from("audit-audio").download(path);
      signal?.throwIfAborted();
      if (error || !data) throw new Error(`Unable to download audio master: ${error?.message ?? "not found"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async saveCatalogMetadata(jobId, claimToken, metadata, signal) {
      await fencedStep(jobId, claimToken, "catalog_metadata", {
        platform: metadata.platform, catalogId: metadata.catalogId, raw: metadata.raw,
        evidenceStatus: metadata.evidenceStatus,
        eventPayload: { platform: metadata.platform, catalogId: metadata.catalogId, hasPreview: Boolean(metadata.previewUrl), evidenceClass: "RECOGNIZED" },
      }, signal);
    },
    async saveRecognition(jobId, claimToken, recognition, signal) {
      await fencedStep(jobId, claimToken, "recognition", {
        matched: recognition.matched,
        artist: recognition.matched ? recognition.artist ?? null : null,
        title: recognition.matched ? recognition.title ?? null : null,
        album: recognition.matched ? recognition.album ?? null : null,
        releaseDate: recognition.matched ? recognition.releaseDate ?? null : null,
        label: recognition.matched ? recognition.label ?? null : null,
        isrc: recognition.matched ? recognition.isrc ?? null : null,
        timecode: recognition.matched ? recognition.timecode ?? null : null,
        songLink: recognition.matched ? recognition.songLink ?? recognition.spotifyUrl ?? null : null,
        rawResponse: recognition.rawResponse ?? recognition,
        eventPayload: { evidenceClass: recognition.matched ? "RECOGNIZED" : null, rawResponsePreserved: Boolean(recognition.rawResponse) },
      }, signal);
    },
    async saveEvidence(jobId, claimToken, recognition, reconciliation, metadata, signal) {
      const identity = reconciliation.identity;
      const hasIdentity = Boolean(identity.artist || identity.title || identity.album || identity.isrc || identity.label || identity.releaseDate);
      const evidenceStatus = reconciliation.status === "reconciled" ? "verified" : hasIdentity ? "partial" : "unresolved";
      const sources: Array<Record<string, unknown>> = [];
      if (metadata) sources.push({
        provider: metadata.platform, url: metadata.canonicalUrl, catalogId: metadata.catalogId,
        evidenceClass: identity.sourceProviders.some((provider) => provider === metadata.platform) ? "RECOGNIZED" : null,
      });
      for (const provider of identity.sourceProviders) {
        if (provider !== metadata?.platform && !sources.some((source) => source.provider === provider)) {
          sources.push({ provider, evidenceClass: "RECOGNIZED" });
        }
      }
      if (recognition.matched && !sources.some((source) => source.provider === "audd")) sources.push({ provider: "audd", evidenceClass: "RECOGNIZED" });
      await fencedStep(jobId, claimToken, "evidence", {
        canonicalArtist: identity.artist, canonicalTitle: identity.title, album: identity.album,
        releaseDate: identity.releaseDate, label: identity.label, isrc: identity.isrc,
        upc: metadata?.upc ?? null,
        spotifyId: metadata?.externalIds.spotify ?? (recognition.matched ? recognition.spotifyId ?? null : null),
        appleMusicId: metadata?.externalIds.apple_music ?? (recognition.matched ? recognition.appleMusicId ?? null : null),
        musicbrainzId: recognition.matched ? recognition.musicbrainzId ?? null : null,
        evidenceStatus, reconciliationStatus: reconciliation.status, sources,
        eventPayload: {
          evidenceClass: reconciliation.status === "reconciled" ? "RECONCILED" : hasIdentity ? "RECOGNIZED" : null,
          evidenceStatus, sources, reconciledFields: reconciliation.reconciledFields,
          conflicts: reconciliation.conflicts, identity,
        },
      }, signal);
    },
    async saveSonicDna(jobId, claimToken, dna, signal) {
      await fencedStep(jobId, claimToken, "sonic_dna", {
        durationSeconds: dna.durationSeconds, sampleRate: dna.sampleRate, channels: dna.channels,
        bpm: dna.bpm, key: dna.key, mode: dna.mode, loudnessLufs: dna.loudnessLufs,
        rmsEnergy: dna.rmsEnergy, dynamicRangeDb: dna.dynamicRangeDb,
        spectralCentroidHz: dna.spectralCentroidHz, spectralBandwidthHz: dna.spectralBandwidthHz,
        spectralRolloffHz: dna.spectralRolloffHz, zeroCrossingRate: dna.zeroCrossingRate,
        rhythmFeatures: dna.rhythmFeatures, harmonicFeatures: dna.harmonicFeatures, vocalFeatures: dna.vocalFeatures,
        moodTags: dna.moodTags, genreContext: dna.genreContext,
        rawFeatures: { ...dna, provenance: "uploaded_audio_master", evidenceClass: "OBSERVED" },
        eventPayload: { analysisVersion: "audit-engine-0.2.0", evidenceClass: "OBSERVED" },
      }, signal);
    },
    async saveAssessment(jobId, claimToken, assessment, signal) {
      await fencedStep(jobId, claimToken, "assessment", {
        model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
        promptVersion: GROQ_PROMPT_VERSION, assessment,
        eventPayload: { provider: "groq", model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, promptVersion: GROQ_PROMPT_VERSION, confidence: assessment.confidence },
      }, signal);
    },
    async saveReport(jobId, claimToken, tier, pdf, reportInput, signal) {
      signal?.throwIfAborted();
      if (!isPdf(pdf)) throw new Error(`Unable to store ${tier} report: generated bytes are not a PDF`);
      const digest = await sha256(pdf);
      signal?.throwIfAborted();
      const storagePath = `${jobId}/${claimToken}/${tier}.pdf`;
      await persistUploadedReport({
        signal,
        upload: async () => {
          const { error } = await admin.storage.from("audit-reports").upload(storagePath, pdf, {
            contentType: "application/pdf", upsert: false,
          });
          if (error) throw new Error(`Unable to store ${tier} report: ${error.message}`);
        },
        // Once this fenced RPC starts, await its definitive result. Aborting
        // its HTTP transport could make commit status ambiguous and cause us
        // to delete a PDF that the database successfully references.
        persist: async () => {
          await fencedStep(jobId, claimToken, "report", {
            tier, storagePath, sha256: digest,
            eventPayload: {
              tier, accessStatus: "available", sha256: digest,
              ...(tier === "full" && reportInput ? { reportInput } : {}),
            },
          });
        },
        cleanup: async () => {
          const { error } = await admin.storage.from("audit-reports").remove([storagePath]);
          if (error) throw new Error(`Unable to clean up interrupted ${tier} report upload: ${error.message}`);
        },
      });
    },
    async markCompleted(jobId, claimToken, signal) {
      await fencedStep(jobId, claimToken, "complete", {}, signal);
    },
    async getAuditStatus(jobId) {
      const { data: job, error: jobError } = await admin
        .from("audit_jobs")
        .select("id,status,error_message")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new Error(`Unable to read audit status: ${jobError.message}`);
      if (!job) throw new Error("Audit job not found");

      const { data: events, error: eventError } = await admin
        .from("audit_events")
        .select("event_type,status,created_at")
        .eq("audit_job_id", jobId)
        .neq("event_type", "audit_failed")
        .order("created_at", { ascending: false })
        .limit(1);
      if (eventError) throw new Error(`Unable to read audit events: ${eventError.message}`);

      const latestEvent = events?.[0];
      const eventStep: Record<string, number> = {
        processing_claimed: 0,
        processing_started: 0,
        recognition: 1,
        catalog_ingestion: 1,
        sonic_dna: 2,
        evidence_reconciliation: 3,
        ar_assessment: 4,
        report_generated: 5,
        audit_completed: 5,
      };
      const currentStepIndex = latestEvent?.event_type && latestEvent.event_type in eventStep
        ? eventStep[latestEvent.event_type]
        : job.status === "completed"
          ? 5
          : 0;

      const { data: reports, error: reportError } = await admin
        .from("audit_reports")
        .select("tier,version,access_status")
        .eq("audit_job_id", jobId)
        .order("version", { ascending: false });
      if (reportError) throw new Error(`Unable to read audit reports: ${reportError.message}`);

      const latest = new Map<string, { version: number; access_status: string }>();
      for (const report of reports ?? []) {
        if (!latest.has(report.tier)) {
          latest.set(report.tier, { version: Number(report.version), access_status: String(report.access_status) });
        }
      }

      const full = latest.get("full");
      return {
        jobId,
        status: job.status as "queued" | "processing" | "completed" | "failed",
        currentStepIndex,
        errorMessage: job.error_message as string | null,
        full: full ? { available: true, version: full.version } : { available: false },
      };
    },
    async getAuditReport(jobId, tier, ownerId) {
      const { data: job, error: jobError } = await admin
        .from("audit_jobs")
        .select("id,owner_id")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new Error(`Unable to read audit job: ${jobError.message}`);
      if (!job) throw new Error("Audit job not found");

      const { data: reports, error: reportError } = await admin
        .from("audit_reports")
        .select("version,storage_path,content_type,access_status")
        .eq("audit_job_id", jobId)
        .eq("tier", tier)
        .order("version", { ascending: false })
        .limit(20);
      if (reportError) throw new Error(`Unable to read audit report: ${reportError.message}`);
      let jsonFallback: Uint8Array | null = null;
      for (const report of reports ?? []) {
        const { data, error: downloadError } = await admin.storage
          .from("audit-reports")
          .download(report.storage_path);
        if (downloadError || !data) continue;
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (isPdf(bytes)) {
          return {
            bytes, contentType: "application/pdf",
            filename: `reson8-audit-${jobId}-${tier}-v${report.version}.pdf`,
          };
        }
        if (!jsonFallback && (String(report.content_type).includes("json") || report.storage_path.endsWith(".json"))) {
          jsonFallback = bytes;
        }
      }

      const payload = jsonFallback ?? await readAuditReportPayload(jobId);
      if (payload !== null) {
        const bytes = await ensurePdfReport(payload, tier);
        return { bytes, contentType: "application/pdf", filename: `audit-report-${tier}.pdf` };
      }
      if (!reports?.length) throw new Error("Report not found");
      throw new Error("Unable to retrieve a compiled PDF or valid report payload");
    },
    async getAuditReportPayload(jobId) {
      return readAuditReportPayload(jobId);
    },
    async markFailed(jobId, claimToken, message, signal) {
      await fencedStep(jobId, claimToken, "fail", { message });
    },
  };
}
