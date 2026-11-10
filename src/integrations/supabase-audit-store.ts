import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreateAuditJobDependencies } from "../jobs/create-audit-job.js";
import type { AuditJobRecord } from "../jobs/process-audit-job.js";
import type { AuditRecognition } from "../providers/audd/normalize.js";
import { type CatalogMetadata } from "../providers/dsp/catalog.js";
import type { MetadataReconciliation } from "../metadata/ReconciliationEngine.js";
import type { SonicDnaFeatures } from "../audio/sonic-dna.js";
import { DEFAULT_GROQ_MODEL, GROQ_PROMPT_VERSION, type ArAssessment } from "../providers/groq/client.js";
import type { AuditReportTier } from "../reports/generate-audit-report.js";
import { sha256 } from "../jobs/content-hash.js";

export interface SupabaseAuditStore {
  admin: SupabaseClient;
  createJobDependencies(): CreateAuditJobDependencies;
  claimNextQueuedJob(): Promise<AuditJobRecord | null>;
  markProcessing(jobId: string): Promise<void>;
  downloadMaster(path: string): Promise<Uint8Array>;
  saveRecognition(jobId: string, recognition: AuditRecognition): Promise<void>;
  saveEvidence(jobId: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata): Promise<void>;
  saveCatalogMetadata(jobId: string, metadata: CatalogMetadata): Promise<void>;
  saveSonicDna(jobId: string, dna: SonicDnaFeatures): Promise<void>;
  saveAssessment(jobId: string, assessment: ArAssessment): Promise<void>;
  saveReport(jobId: string, tier: AuditReportTier, pdf: Uint8Array): Promise<void>;
  markCompleted(jobId: string): Promise<void>;
  markFailed(jobId: string, message: string): Promise<void>;
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

  const event = async (jobId: string, eventType: string, status: string, message?: string, payload: Record<string, unknown> = {}) => {
    const { error } = await admin.from("audit_events").insert({ audit_job_id: jobId, event_type: eventType, status, message, payload });
    if (error) throw new Error(`Unable to write audit event: ${error.message}`);
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
      const { data: queued, error: selectError } = await admin
        .from("audit_jobs").select("id,owner_id,source_audio_path,mime_type,source_type,catalog_url,status")
        .eq("status", "queued")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (selectError) throw new Error(`Unable to read queued audits: ${selectError.message}`);
      if (!queued) return null;
      if (queued.source_type === "master" && !queued.source_audio_path) return null;
      if (queued.source_type === "dsp_link" && !queued.catalog_url) return null;
      const { data: claimed, error: claimError } = await admin
        .from("audit_jobs").update({ status: "processing", started_at: new Date().toISOString() })
        .eq("id", queued.id).eq("status", "queued")
        .select("id,owner_id,source_audio_path,mime_type,source_type,catalog_url,status").maybeSingle();
      if (claimError) throw new Error(`Unable to claim audit job: ${claimError.message}`);
      if (!claimed) return null;
      await event(claimed.id, "processing_claimed", "processing");
      return {
        id: claimed.id as string,
        ownerId: claimed.owner_id as string | null,
        sourceAudioPath: claimed.source_audio_path as string | null,
        mimeType: claimed.mime_type as string | null,
        sourceType: (claimed.source_type ?? "master") as "master" | "dsp_link",
        catalogUrl: claimed.catalog_url as string | null,
        status: "queued",
      };
    },
    async markProcessing(jobId) { await event(jobId, "processing_started", "processing"); },
    async downloadMaster(path) {
      const { data, error } = await admin.storage.from("audit-audio").download(path);
      if (error || !data) throw new Error(`Unable to download audio master: ${error?.message ?? "not found"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async saveCatalogMetadata(jobId, metadata) {
      const { error: jobError } = await admin.from("audit_jobs").update({
        catalog_platform: metadata.platform, catalog_id: metadata.catalogId, catalog_metadata: metadata.raw,
      }).eq("id", jobId);
      if (jobError) throw new Error(`Unable to save catalog metadata: ${jobError.message}`);
      await event(jobId, "catalog_ingestion", metadata.evidenceStatus, undefined, {
        platform: metadata.platform, catalogId: metadata.catalogId, hasPreview: Boolean(metadata.previewUrl),
        evidenceClass: "RECOGNIZED",
      });
    },
    async saveRecognition(jobId, recognition) {
      const row = {
        audit_job_id: jobId, provider: "audd", matched: recognition.matched,
        artist: recognition.matched ? recognition.artist ?? null : null,
        title: recognition.matched ? recognition.title ?? null : null,
        album: recognition.matched ? recognition.album ?? null : null,
        release_date: recognition.matched ? recognition.releaseDate ?? null : null,
        label: recognition.matched ? recognition.label ?? null : null,
        isrc: recognition.matched ? recognition.isrc ?? null : null,
        timecode: recognition.matched ? recognition.timecode ?? null : null,
        song_link: recognition.matched ? recognition.songLink ?? recognition.spotifyUrl ?? null : null,
        raw_response: recognition.matched ? recognition.rawResponse ?? recognition : recognition,
      };
      const { error } = await admin.from("recognition_results").upsert(row, { onConflict: "audit_job_id,provider" });
      if (error) throw new Error(`Unable to save recognition: ${error.message}`);
      await event(jobId, "recognition", recognition.matched ? "matched" : "unmatched");
    },
    async saveEvidence(jobId, recognition, reconciliation, metadata) {
      const identity = reconciliation.identity;
      const hasIdentity = Boolean(identity.artist || identity.title || identity.album || identity.isrc || identity.label || identity.releaseDate);
      const evidenceStatus = reconciliation.status === "reconciled"
        ? "verified"
        : hasIdentity ? "partial" : "unresolved";
      const sources: Array<Record<string, unknown>> = [];
      for (const provider of identity.sourceProviders) {
        sources.push({ provider, evidenceClass: "RECOGNIZED" });
      }
      if (recognition.matched && !sources.some((source) => source.provider === "audd")) {
        sources.push({ provider: "audd", evidenceClass: "RECOGNIZED" });
      }
      if (metadata && !sources.some((source) => source.provider === metadata.platform)) {
        sources.push({
          provider: metadata.platform,
          url: metadata.canonicalUrl,
          catalogId: metadata.catalogId,
          evidenceClass: "RECOGNIZED",
        });
      }
      const { error } = await admin.from("reconciled_tracks").upsert({
        audit_job_id: jobId,
        canonical_artist: identity.artist,
        canonical_title: identity.title,
        album: identity.album,
        release_date: identity.releaseDate,
        label: identity.label,
        isrc: identity.isrc,
        upc: metadata?.upc ?? null,
        spotify_id: metadata?.externalIds.spotify ?? (recognition.matched ? recognition.spotifyId ?? null : null),
        apple_music_id: metadata?.externalIds.apple_music ?? (recognition.matched ? recognition.appleMusicId ?? null : null),
        musicbrainz_id: recognition.matched ? recognition.musicbrainzId ?? null : null,
        evidence_status: evidenceStatus,
        confidence: null,
        sources,
      }, { onConflict: "audit_job_id" });
      if (error) throw new Error(`Unable to save reconciled evidence: ${error.message}`);
      await event(jobId, "evidence_reconciliation", reconciliation.status, undefined, {
        evidenceClass: reconciliation.status === "reconciled" ? "RECONCILED" : hasIdentity ? "RECOGNIZED" : null,
        evidenceStatus,
        sources,
        reconciledFields: reconciliation.reconciledFields,
        conflicts: reconciliation.conflicts,
        identity,
      });
    },
    async saveSonicDna(jobId, dna) {
      const { error } = await admin.from("sonic_dna").upsert({
        audit_job_id: jobId, analysis_version: "audit-engine-0.1.0", duration_seconds: dna.durationSeconds,
        sample_rate: dna.sampleRate, channels: dna.channels, bpm: dna.bpm, key: dna.key, mode: dna.mode,
        loudness_lufs: dna.loudnessLufs, rms_energy: dna.rmsEnergy, dynamic_range_db: dna.dynamicRangeDb,
        spectral_centroid_hz: dna.spectralCentroidHz, spectral_bandwidth_hz: dna.spectralBandwidthHz,
        spectral_rolloff_hz: dna.spectralRolloffHz, zero_crossing_rate: dna.zeroCrossingRate,
        mood_tags: dna.moodTags, genre_context: dna.genreContext, raw_features: dna,
      }, { onConflict: "audit_job_id" });
      if (error) throw new Error(`Unable to save Sonic DNA: ${error.message}`);
      await admin.from("audit_jobs").update({ duration_seconds: dna.durationSeconds }).eq("id", jobId);
      await event(jobId, "sonic_dna", "completed", undefined, { analysisVersion: "audit-engine-0.1.0" });
    },
    async saveAssessment(jobId, assessment) {
      const { error } = await admin.from("audit_assessments").upsert({
        audit_job_id: jobId,
        provider: "groq",
        model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
        prompt_version: GROQ_PROMPT_VERSION,
        status: "completed",
        assessment,
      }, { onConflict: "audit_job_id" });
      if (error) throw new Error(`Unable to save A&R assessment: ${error.message}`);
      await event(jobId, "ar_assessment", "completed", undefined, {
        provider: "groq",
        model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
        promptVersion: GROQ_PROMPT_VERSION,
        confidence: assessment.confidence,
      });
    },
    async saveReport(jobId, tier, pdf) {
      const digest = await sha256(pdf);
      const { data: latest, error: latestError } = await admin
        .from("audit_reports")
        .select("version")
        .eq("audit_job_id", jobId)
        .eq("tier", tier)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw new Error(`Unable to read report version: ${latestError.message}`);

      const version = Number(latest?.version ?? 0) + 1;
      const storagePath = `${jobId}/v${version}/${tier}.pdf`;
      const { error: uploadError } = await admin.storage
        .from("audit-reports")
        .upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error(`Unable to store ${tier} report: ${uploadError.message}`);

      const { error } = await admin.from("audit_reports").insert({
        audit_job_id: jobId,
        tier,
        version,
        access_status: "available",
        storage_path: storagePath,
        sha256: digest,
        content_type: "application/pdf",
      });
      if (error) {
        await admin.storage.from("audit-reports").remove([storagePath]);
        throw new Error(`Unable to persist ${tier} report metadata: ${error.message}`);
      }

      await event(jobId, "report_generated", "completed", undefined, {
        tier,
        version,
        accessStatus: "available",
        sha256: digest,
      });
    },
    async markCompleted(jobId) {
      const { error } = await admin.from("audit_jobs").update({ status: "completed", completed_at: new Date().toISOString(), error_code: null, error_message: null }).eq("id", jobId);
      if (error) throw new Error(`Unable to complete audit job: ${error.message}`);
      await event(jobId, "audit_completed", "completed");
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

      const { data: report, error: reportError } = await admin
        .from("audit_reports")
        .select("version,storage_path,content_type,access_status")
        .eq("audit_job_id", jobId)
        .eq("tier", tier)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reportError) throw new Error(`Unable to read audit report: ${reportError.message}`);
      if (!report) throw new Error("Report not found");
      const { data, error: downloadError } = await admin.storage
        .from("audit-reports")
        .download(report.storage_path);
      if (downloadError || !data) throw new Error(`Unable to download audit report: ${downloadError?.message ?? "not found"}`);

      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        contentType: report.content_type as string,
        filename: `reson8-audit-${jobId}-${tier}-v${report.version}.pdf`,
      };
    },
    async markFailed(jobId, message) {
      const { error } = await admin.from("audit_jobs").update({ status: "failed", completed_at: new Date().toISOString(), error_code: "AUDIT_PROCESSING_FAILED", error_message: message }).eq("id", jobId);
      if (error) throw new Error(`Unable to mark audit job failed: ${error.message}`);
      await event(jobId, "audit_failed", "failed", message);
    },
  };
}
