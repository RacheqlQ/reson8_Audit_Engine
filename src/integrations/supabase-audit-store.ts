import { randomUUID, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreateAuditJobDependencies } from "../jobs/create-audit-job.js";
import type { AuditJobRecord } from "../jobs/process-audit-job.js";
import type { AuditRecognition } from "../providers/audd/normalize.js";
import { type CatalogMetadata } from "../providers/dsp/catalog.js";
import { normalizeDspTrackLinks } from "../providers/dsp/intake.js";
import type { MetadataReconciliation } from "../metadata/ReconciliationEngine.js";
import type { SonicDnaFeatures } from "../audio/sonic-dna.js";
import { DEFAULT_GROQ_MODEL, GROQ_PROMPT_VERSION, type ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
import { ensurePdfReport, isPdf } from "../reports/pdf-output.js";
import { sha256 } from "../jobs/content-hash.js";
import { withAbortTimeout } from "../jobs/with-abort-timeout.js";
import { persistUploadedReport } from "../jobs/report-persistence.js";
import { getAuditProgressStepIndex } from "../jobs/audit-progress.js";
import type { SanitizedAuditFailure } from "../jobs/audit-failure.js";

const REPORT_RECONCILIATION_TIMEOUT_MS = 2_000;
const REPORT_CLEANUP_TIMEOUT_MS = 2_000;

export interface SupabaseAuditStore {
  admin: SupabaseClient;
  createJobDependencies(): CreateAuditJobDependencies;
  claimNextQueuedJob(): Promise<AuditJobRecord | null>;
  failExpiredProcessingJobs(): Promise<number>;
  renewLease(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markProcessing(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  downloadMaster(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  saveRecognition(jobId: string, claimToken: string, recognition: AuditRecognition, signal?: AbortSignal): Promise<void>;
  saveEvidence(jobId: string, claimToken: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata, signal?: AbortSignal, metadataSources?: readonly CatalogMetadata[]): Promise<void>;
  saveCatalogMetadata(jobId: string, claimToken: string, metadata: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  saveCatalogFailure(
    jobId: string,
    claimToken: string,
    link: { platform: string; catalogId: string; canonicalUrl: string },
    error: string,
    signal?: AbortSignal,
  ): Promise<void>;
  saveSonicDna(jobId: string, claimToken: string, dna: SonicDnaFeatures, signal?: AbortSignal): Promise<void>;
  saveAssessment(jobId: string, claimToken: string, assessment: ArAssessment, signal?: AbortSignal): Promise<void>;
  loadAssessmentSectionGroup(jobId: string, group: string): Promise<unknown | null>;
  saveAssessmentSectionGroup(jobId: string, claimToken: string, group: string, result: unknown, signal?: AbortSignal): Promise<void>;
  saveReport(jobId: string, claimToken: string, tier: AuditReportTier, pdf: Uint8Array, reportInput?: AuditReportInput, signal?: AbortSignal): Promise<void>;
  markCompleted(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markFailed(jobId: string, claimToken: string, message: string, signal?: AbortSignal, failure?: SanitizedAuditFailure): Promise<void>;
  getAuditStatus(jobId: string): Promise<{
    jobId: string;
    status: "queued" | "processing" | "completed" | "failed";
    currentStepIndex: number;
    errorMessage?: string | null;
    full: { available: boolean; version?: number };
    catalogUrlsSubmitted?: string[];
    catalogSources?: Array<{ platform: string; canonicalUrl: string; status: string; reason: string }>;
  }>;
  getAuditReport(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
    filename: string;
  }>;
  getAuditReportPayload(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<unknown | null>;
  verifyAuditAccessToken(jobId: string, token: string): Promise<boolean>;
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
  const recordSubmittedCatalogLinks = async (jobId: string, links: string[]) => {
    if (!links.length) return;
    const { error } = await admin.from("audit_events").insert({
      audit_job_id: jobId,
      event_type: "catalog_links_submitted",
      status: "submitted",
      payload: { submittedLinks: links },
    });
    if (error) {
      await admin.from("audit_jobs").delete().eq("id", jobId);
      throw new Error(`Unable to persist submitted DSP links: ${error.message}`);
    }
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
            source_type: input.sourceType, catalog_url: input.catalogUrl,
            catalog_metadata: input.catalogUrls?.length ? { submittedLinks: input.catalogUrls } : {},
            report_access_token_hash: input.reportAccessTokenHash,
          }).select("id").single();
          if (error || !data) throw new Error(`Unable to create audit job: ${error?.message ?? "unknown error"}`);
          if (input.catalogUrls?.length) await recordSubmittedCatalogLinks(data.id as string, input.catalogUrls);
          return data.id as string;
        },
        createCatalogJob: async (input) => {
          const { data, error } = await admin.from("audit_jobs").insert({
            owner_id: input.ownerId, status: "queued", source_type: "dsp_link",
            catalog_url: input.catalogUrl,
            catalog_metadata: { submittedLinks: input.catalogUrls ?? [input.catalogUrl] },
            sha256: input.sha256, report_access_token_hash: input.reportAccessTokenHash,
          }).select("id").single();
          if (error || !data) throw new Error(`Unable to create catalog audit job: ${error?.message ?? "unknown error"}`);
          await recordSubmittedCatalogLinks(data.id as string, input.catalogUrls ?? [input.catalogUrl]);
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
    async failExpiredProcessingJobs() {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
      const nowIso = now.toISOString();
      const { data, error } = await admin.from("audit_jobs")
        .select("id")
        .eq("status", "processing")
        .lt("created_at", cutoff)
        .lt("lease_expires_at", nowIso)
        .limit(50);
      if (error) throw new Error("Unable to inspect expired audit jobs");
      let failed = 0;
      for (const row of data ?? []) {
        const { error: updateError } = await admin.from("audit_jobs").update({
          status: "failed",
          error_code: "AUDIT_JOB_EXPIRED",
          error_message: "This audit could not be completed within 10 minutes. Please submit it again.",
          completed_at: nowIso,
          lease_expires_at: null,
          claim_token: null,
          worker_id: null,
        }).eq("id", row.id).eq("status", "processing").lt("lease_expires_at", nowIso);
        if (!updateError) failed++;
      }
      return failed;
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
      const claimedMetadata = claimed.catalog_metadata && typeof claimed.catalog_metadata === "object"
        ? claimed.catalog_metadata as Record<string, unknown> : {};
      let catalogUrls = Array.isArray(claimedMetadata.submittedLinks)
        ? claimedMetadata.submittedLinks.filter((value): value is string => typeof value === "string")
        : undefined;
      if (!catalogUrls?.length) {
        const { data: linksEvent, error: linksError } = await admin.from("audit_events")
          .select("payload")
          .eq("audit_job_id", claimed.id)
          .eq("event_type", "catalog_links_submitted")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (linksError) throw new Error(`Unable to load submitted DSP links: ${linksError.message}`);
        const linksPayload = linksEvent?.payload as Record<string, unknown> | null;
        catalogUrls = Array.isArray(linksPayload?.submittedLinks)
          ? linksPayload.submittedLinks.filter((value): value is string => typeof value === "string")
          : undefined;
      }
      return {
        id: claimed.id as string,
        ownerId: claimed.owner_id as string | null,
        sourceAudioPath: claimed.source_audio_path as string | null,
        mimeType: claimed.mime_type as string | null,
        filename: claimed.original_filename as string | null,
        sourceType: (claimed.source_type ?? "master") as "master" | "dsp_link" | "combined",
        catalogUrl: claimed.catalog_url as string | null,
        catalogUrls,
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
    async markProcessing(jobId, claimToken, signal) {
      await fencedStep(jobId, claimToken, "processing_started", {}, signal);
    },
    async downloadMaster(path, signal) {
      signal?.throwIfAborted();
      const objectPath = path.split("/").map(encodeURIComponent).join("/");
      const downloadUrl = new URL(`/storage/v1/object/authenticated/audit-audio/${objectPath}`, url);
      const response = await fetch(downloadUrl, {
        method: "GET",
        headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
        signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Unable to download audio master: HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async saveCatalogMetadata(jobId, claimToken, metadata, signal) {
      const spotifyFailure = metadata.raw?.spotifyEnrichment;
      const spotifyUnavailable = Boolean(
        spotifyFailure && typeof spotifyFailure === "object"
        && (spotifyFailure as Record<string, unknown>).status === "unavailable",
      );
      const providerError = spotifyUnavailable
        ? typeof (spotifyFailure as Record<string, unknown>).error === "string"
          ? ((spotifyFailure as Record<string, unknown>).error as string).slice(0, 240)
          : "Spotify API enrichment is unavailable"
        : null;
      await fencedStep(jobId, claimToken, "catalog_metadata", {
        platform: metadata.platform,
        catalogId: metadata.catalogId,
        raw: metadata.raw,
        evidenceStatus: metadata.evidenceStatus,
        eventPayload: {
          platform: metadata.platform,
          catalogId: metadata.catalogId,
          canonicalUrl: metadata.sourceUrl,
          resolvedCanonicalUrl: metadata.canonicalUrl,
          sourceUrl: metadata.sourceUrl,
          status: spotifyUnavailable ? "unavailable" : metadata.evidenceStatus,
          error: providerError,
          fields: {
            artist: metadata.artist, title: metadata.title, album: metadata.album,
            releaseDate: metadata.releaseDate, isrc: metadata.isrc, upc: metadata.upc,
            label: metadata.label, genre: metadata.genre,
          },
          raw: metadata.raw,
          hasPreview: Boolean(metadata.previewUrl),
          evidenceClass: spotifyUnavailable ? null : metadata.evidenceStatus === "recognized" ? "RECOGNIZED" : "PARTIAL",
        },
      }, signal);
    },
    async saveCatalogFailure(jobId, claimToken, link, error, signal) {
      await fencedStep(jobId, claimToken, "catalog_metadata", {
        platform: link.platform,
        catalogId: link.catalogId,
        raw: { providerStatus: "unavailable" },
        evidenceStatus: "unavailable",
        eventPayload: {
          platform: link.platform,
          canonicalUrl: link.canonicalUrl,
          sourceUrl: link.canonicalUrl,
          status: "unavailable",
          error: error.slice(0, 240),
          evidenceClass: null,
        },
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
    async saveEvidence(jobId, claimToken, recognition, reconciliation, metadata, signal, additionalMetadataSources) {
      const identity = reconciliation.identity;
      const hasIdentity = Boolean(identity.artist || identity.title || identity.album || identity.isrc || identity.label || identity.releaseDate);
      const evidenceStatus = reconciliation.status === "reconciled" ? "verified" : hasIdentity ? "partial" : "unresolved";
      const metadataSources: readonly CatalogMetadata[] = additionalMetadataSources?.length
        ? additionalMetadataSources
        : metadata ? [metadata] : [];
      const sources: Array<Record<string, unknown>> = metadataSources.map((source) => ({
        provider: source.platform,
        url: source.canonicalUrl,
        sourceUrl: source.sourceUrl,
        catalogId: source.catalogId,
        evidenceClass: identity.sourceProviders.some((provider) => provider === source.platform) ? "RECOGNIZED" : null,
      }));
      for (const provider of identity.sourceProviders) {
        if (!sources.some((source) => source.provider === provider)) {
          sources.push({ provider, evidenceClass: "RECOGNIZED" });
        }
      }
      if (recognition.matched && !sources.some((source) => source.provider === "audd")) sources.push({ provider: "audd", evidenceClass: "RECOGNIZED" });
      const spotifyId = metadataSources.find((source) => source.externalIds.spotify)?.externalIds.spotify;
      const appleMusicId = metadataSources.find((source) => source.externalIds.apple_music)?.externalIds.apple_music;
      await fencedStep(jobId, claimToken, "evidence", {
        canonicalArtist: identity.artist, canonicalTitle: identity.title, album: identity.album,
        releaseDate: identity.releaseDate, label: identity.label, isrc: identity.isrc,
        upc: metadataSources.find((source) => source.upc)?.upc ?? null,
        spotifyId: spotifyId ?? (recognition.matched ? recognition.spotifyId ?? null : null),
        appleMusicId: appleMusicId ?? (recognition.matched ? recognition.appleMusicId ?? null : null),
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
      const genreEvidenceAudit = dna.genreClassification
        ? {
            taxonomyVersion: dna.genreClassification.taxonomyVersion,
            primaryGenre: dna.genreClassification.primaryGenre,
            confidence: dna.genreClassification.confidence,
            abstained: dna.genreClassification.abstained,
            unmappedTags: dna.genreClassification.unmappedTags,
          }
        : undefined;
      const genreFeatureCapture = process.env.GENRE_FEATURE_CAPTURE_ENABLED === "true" && dna.genreClassification
        ? {
            taxonomyVersion: dna.genreClassification.taxonomyVersion,
            candidateGenreIds: dna.genreClassification.genres.map((genre) => genre.id),
            confidence: dna.genreClassification.confidence,
            abstained: dna.genreClassification.abstained,
            tempoContributionCap: dna.genreClassification.evidence.tempoContributionCap,
          }
        : undefined;
      await fencedStep(jobId, claimToken, "sonic_dna", {
        durationSeconds: dna.durationSeconds, sampleRate: dna.sampleRate, channels: dna.channels,
        bpm: dna.bpm, key: dna.key, mode: dna.mode, loudnessLufs: dna.loudnessLufs,
        rmsEnergy: dna.rmsEnergy, dynamicRangeDb: dna.dynamicRangeDb,
        spectralCentroidHz: dna.spectralCentroidHz, spectralBandwidthHz: dna.spectralBandwidthHz,
        spectralRolloffHz: dna.spectralRolloffHz, zeroCrossingRate: dna.zeroCrossingRate,
        rhythmFeatures: dna.rhythmFeatures, harmonicFeatures: dna.harmonicFeatures, vocalFeatures: dna.vocalFeatures,
        moodTags: dna.moodTags, genreContext: dna.genreContext,
        rawFeatures: { ...dna, provenance: "uploaded_audio_master", evidenceClass: "OBSERVED" },
        eventPayload: {
          analysisVersion: "audit-engine-0.2.0",
          evidenceClass: "OBSERVED",
          diagnostics: {
            version: 1,
            tempo: {
              method: dna.rhythmFeatures.method ?? null,
              candidateScores: dna.rhythmFeatures.candidateScores ?? [],
              onsetEnvelope: dna.rhythmFeatures.onsetEnvelope ?? [],
              beatTimesSeconds: dna.rhythmFeatures.beatTimesSeconds ?? [],
              downbeatCandidateTimesSeconds: dna.rhythmFeatures.downbeatCandidateTimesSeconds ?? [],
              beatGridStatus: dna.rhythmFeatures.beatGridStatus ?? "not_determined",
              downbeatGridAssumption: dna.rhythmFeatures.downbeatGridAssumption ?? null,
            },
            key: {
              method: dna.harmonicFeatures.method ?? null,
              tuningCents: dna.keyTuningCents,
              segmentAgreement: dna.keySegmentAgreement,
              segmentChroma: dna.harmonicFeatures.segmentChroma ?? [],
            },
          },
          ...(genreEvidenceAudit ? { genreEvidenceAudit } : {}),
          ...(genreFeatureCapture ? { genreFeatureCapture } : {}),
        },
      }, signal);
    },
    async loadAssessmentSectionGroup(jobId, group) {
      const { data, error } = await admin.from("audit_events")
        .select("payload")
        .eq("audit_job_id", jobId)
        .eq("event_type", "groq_section_completed")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("Unable to resume completed AI assessment section");
      const match = (data ?? []).find((event) => {
        const payload = event.payload as Record<string, unknown> | null;
        return payload?.group === group && payload.result !== undefined
          && payload.promptVersion === GROQ_PROMPT_VERSION
          && payload.model === (process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL);
      });
      return match ? (match.payload as Record<string, unknown>).result : null;
    },
    async saveAssessmentSectionGroup(jobId, claimToken, group, result, signal) {
      signal?.throwIfAborted();
      const { data: activeJob, error: activeJobError } = await admin.from("audit_jobs")
        .select("status,claim_token")
        .eq("id", jobId)
        .maybeSingle();
      if (activeJobError || !activeJob || activeJob.status !== "processing" || activeJob.claim_token !== claimToken) {
        throw new Error("AUDIT_LEASE_LOST");
      }
      const { error } = await admin.from("audit_events").insert({
        audit_job_id: jobId,
        event_type: "groq_section_completed",
        status: "completed",
        payload: { group, result, promptVersion: GROQ_PROMPT_VERSION, model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL },
      });
      if (error) throw new Error("Unable to persist completed AI assessment section");
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
      try {
        await persistUploadedReport({
          signal,
          upload: async () => {
            const objectPath = storagePath.split("/").map(encodeURIComponent).join("/");
            const uploadUrl = new URL(`/storage/v1/object/audit-reports/${objectPath}`, url);
            const response = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                apikey: secretKey,
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/pdf",
                "x-upsert": "false",
              },
              body: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
              signal,
            });
            const detail = await response.text();
            if (!response.ok) {
              throw new Error(`Unable to store ${tier} report: HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
            }
          },
          // The fenced RPC receives the worker signal. If transport abort makes
          // the commit outcome uncertain, reconcile() takes the same job-row lock
          // before cleanup so a committed report object is never deleted.
          persist: async () => {
            await fencedStep(jobId, claimToken, "report", {
              tier, storagePath, sha256: digest,
              eventPayload: {
                tier, accessStatus: "available", sha256: digest,
                ...(tier === "full" && reportInput ? { reportInput } : {}),
              },
            }, signal);
          },
          reconcile: async () => {
            const { data, error } = await withAbortTimeout(
              (timeoutSignal) => Promise.resolve(admin.rpc("reconcile_audit_report_reference", {
                p_job_id: jobId,
                p_tier: tier,
                p_storage_path: storagePath,
                p_sha256: digest,
              }).abortSignal(timeoutSignal)),
              REPORT_RECONCILIATION_TIMEOUT_MS,
              "AUDIT_REPORT_RECONCILIATION_TIMEOUT",
            );
            if (error) throw new Error(`Unable to reconcile ${tier} report persistence: ${error.message}`);
            if (typeof data !== "boolean") {
              throw new Error("Report persistence reconciliation returned an invalid result");
            }
            return data;
          },
          cleanup: async () => {
            await withAbortTimeout(async (timeoutSignal) => {
              const deleteUrl = new URL("/storage/v1/object/audit-reports", url);
              const response = await fetch(deleteUrl, {
                method: "DELETE",
                headers: {
                  apikey: secretKey,
                  Authorization: `Bearer ${secretKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ prefixes: [storagePath] }),
                signal: timeoutSignal,
              });
              const detail = await response.text();
              if (!response.ok) {
                throw new Error(`Unable to clean up interrupted ${tier} report upload: HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
              }
            }, REPORT_CLEANUP_TIMEOUT_MS, "AUDIT_REPORT_CLEANUP_TIMEOUT");
          },
        });
      } catch (error) {
        if (error instanceof AggregateError) {
          console.error(JSON.stringify({
            worker: "audit",
            jobId,
            event: error.message.includes("outcome is unknown")
              ? "report_artifact_persistence_outcome_unknown"
              : "report_artifact_cleanup_failed",
            tier,
            errors: error.errors.map((entry) => entry instanceof Error ? entry.message : String(entry)),
          }));
        }
        throw error;
      }
    },
    async markCompleted(jobId, claimToken, signal) {
      await fencedStep(jobId, claimToken, "complete", {}, signal);
    },
    async verifyAuditAccessToken(jobId, token) {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
      const { data, error } = await admin.from("audit_jobs")
        .select("report_access_token_hash")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw new Error(`Unable to verify audit access token: ${error.message}`);
      const expected = typeof data?.report_access_token_hash === "string" ? data.report_access_token_hash : "";
      if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
      const suppliedHash = await sha256(new TextEncoder().encode(token));
      const expectedBytes = Buffer.from(expected, "hex");
      const suppliedBytes = Buffer.from(suppliedHash, "hex");
      return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
    },
    async getAuditStatus(jobId) {
      const { data: job, error: jobError } = await admin
        .from("audit_jobs")
        .select("id,status,error_code,error_message,catalog_metadata")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new Error(`Unable to read audit status: ${jobError.message}`);
      if (!job) throw new Error("Audit job not found");

      const { data: events, error: eventError } = await admin
        .from("audit_events")
        .select("event_type,status,created_at,payload")
        .eq("audit_job_id", jobId)
        .in("event_type", [
          "processing_claimed", "processing_started", "recognition", "catalog_ingestion",
          "sonic_dna", "evidence_reconciliation", "ar_assessment", "report_generated",
          "audit_completed", "catalog_links_submitted", "audit_failed",
        ])
        .order("created_at", { ascending: true });
      if (eventError) throw new Error(`Unable to read audit events: ${eventError.message}`);

      const catalogEvents = (events ?? []).filter((event) => event.event_type === "catalog_ingestion");
      const submittedEvent = (events ?? []).find((event) => event.event_type === "catalog_links_submitted");
      const submittedPayload = submittedEvent?.payload as Record<string, unknown> | null;
      const catalogUrlsSubmitted = Array.isArray(submittedPayload?.submittedLinks)
        ? submittedPayload.submittedLinks.filter((value): value is string => typeof value === "string")
        : [];
      const catalogStatusMap = new Map<string, { platform: string; canonicalUrl: string; status: string; reason: string }>();
      for (const event of catalogEvents ?? []) {
        const payload = event.payload as Record<string, unknown> | null;
        if (typeof payload?.platform !== "string" || typeof payload?.canonicalUrl !== "string") continue;
        const key = `${payload.platform}:${payload.canonicalUrl}`;
        catalogStatusMap.set(key, {
          platform: payload.platform,
          canonicalUrl: payload.canonicalUrl,
          status: typeof payload.status === "string" ? payload.status : "recognized",
          reason: payload.status === "recognized" ? "Provider returned track metadata." : payload.status === "partial" ? "Provider returned incomplete metadata; some identity fields remain unresolved." : "Provider could not verify this submitted link.",
        });
      }
      const catalogSources = catalogUrlsSubmitted.length ? normalizeDspTrackLinks(catalogUrlsSubmitted).map((link) =>
        catalogStatusMap.get(`${link.platform}:${link.canonicalUrl}`) ?? {
          platform: link.platform,
          catalogId: link.catalogId,
          canonicalUrl: link.canonicalUrl,
          status: job.status === "completed" || job.status === "failed" ? "unavailable" : "pending",
          reason: "Provider lookup has not completed.",
        },
      ) : [];

      const failedEvent = (events ?? []).find((event) => event.event_type === "audit_failed");
      const failedPayload = failedEvent?.payload as Record<string, unknown> | null;
      const rawFailure = failedPayload?.failure && typeof failedPayload.failure === "object"
        ? failedPayload.failure as Record<string, unknown> : null;
      const failureDetails = rawFailure ? {
        provider: typeof rawFailure.provider === "string" ? rawFailure.provider : null,
        httpStatus: typeof rawFailure.httpStatus === "number" ? rawFailure.httpStatus : null,
        errorType: typeof rawFailure.errorType === "string" ? rawFailure.errorType : "unknown",
        retryable: rawFailure.retryable === true,
      } : null;

      const currentStepIndex = getAuditProgressStepIndex(
        (events ?? []).map((event) => String(event.event_type)),
        job.status as "queued" | "processing" | "completed" | "failed",
      );

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
        errorCode: typeof job.error_code === "string" ? job.error_code : null,
        failureDetails,
        errorMessage: typeof job.error_message === "string" && job.error_message.startsWith("AI capacity reached for now") ? job.error_message
          : job.error_message === "GROQ_ASSESSMENT_TIMEOUT" ? "AI assessment: the analysis exceeded its four-minute time limit. Please retry later."
          : typeof job.error_message === "string" && /^(?:Catalog lookup|Audio intake|Audio recognition|Sonic DNA|AI assessment|Sample report|Full report|Audit processing):/.test(job.error_message) ? job.error_message
          : job.status === "failed" ? "Audit processing: a required stage could not be completed. Please retry the audit." : null,
        full: full ? { available: true, version: full.version } : { available: false },
        catalogUrlsSubmitted,
        catalogSources,
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
    async markFailed(jobId, claimToken, message, signal, failure) {
      await fencedStep(jobId, claimToken, "fail", {
        message,
        errorCode: failure?.errorCode ?? "AUDIT_PROCESSING_FAILED",
        eventPayload: failure ? { failure } : {},
      }, signal);
    },
  };
}
