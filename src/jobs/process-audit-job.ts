import type { AuditRecognition } from "../providers/audd/normalize.js";
import type { CatalogMetadata } from "../providers/dsp/catalog.js";
import type { ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
import { isPdf } from "../reports/pdf-output.js";
import type { SonicDnaFeatures } from "../audio/sonic-dna.js";
import { unavailableVocalAnalysis, type VocalAnalysisResult } from "../audio/vocal-analysis.js";
import { analyzePcmWithTimeout } from "../audio/sonic-dna-worker-client.js";
import { fuseGenreEvidence, type ProviderGenreTags } from "../genre/fusion.js";
import { DEFAULT_GENRE_MODEL } from "../genre/model.js";
import type { TrackIdentity } from "../metadata/MetadataEngine.js";
import { reconcileMetadata, type MetadataReconciliation } from "../metadata/ReconciliationEngine.js";
import { readAudioTags } from "../metadata/audio-tags.js";
import { normalizeDspTrackLinks } from "../providers/dsp/intake.js";
import { collectDspMetadata, type DspMetadataResult } from "../providers/dsp/registry.js";
import { collectIsrcCatalogMetadata, type IsrcCatalogLookup } from "../providers/dsp/isrc-catalog.js";
import { discoverPlaylistCandidates, type PlaylistDiscoveryInput, type PlaylistDiscoveryResult } from "../providers/dsp/playlist-discovery.js";
import { normalizeIsrc } from "../providers/musicbrainz/client.js";
import { providerDecision } from "../providers/provider-policy.js";
import { getAuditSourceReadinessError } from "../audio/master-audio-evidence.js";
import { withAbortTimeout } from "./with-abort-timeout.js";

export interface AuditJobRecord {
  id: string;
  ownerId: string | null;
  sourceAudioPath: string | null;
  mimeType: string | null;
  filename?: string | null;
  sourceType: "master" | "dsp_link" | "combined";
  catalogUrl: string | null;
  catalogUrls?: string[];
  status: "queued" | "processing" | "completed" | "failed";
  claimToken: string;
  leaseExpiresAt: string;
  workerId: string;
}

export interface AuditProcessorDependencies {
  getJob(jobId: string, signal?: AbortSignal): Promise<AuditJobRecord | null>;
  markProcessing(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  collectCatalogMetadata(url: string, signal?: AbortSignal): Promise<CatalogMetadata>;
  collectIsrcCatalogMetadata?(isrc: string, signal?: AbortSignal): Promise<IsrcCatalogLookup>;
  discoverPlaylists?(input: PlaylistDiscoveryInput, signal?: AbortSignal): Promise<PlaylistDiscoveryResult>;
  recognizeUrl(url: string, signal?: AbortSignal): Promise<AuditRecognition>;
  downloadMaster(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  createRecognitionSample(master: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<Uint8Array>;
  recognize(sample: Uint8Array, signal?: AbortSignal): Promise<AuditRecognition>;
  saveRecognition(jobId: string, claimToken: string, recognition: AuditRecognition, signal?: AbortSignal): Promise<void>;
  saveEvidence(jobId: string, claimToken: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata, signal?: AbortSignal, metadataSources?: readonly CatalogMetadata[]): Promise<void>;
  saveCatalogMetadata(jobId: string, claimToken: string, metadata: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  saveCatalogFailure?(
    jobId: string,
    claimToken: string,
    link: DspMetadataResult["link"],
    error: string,
    signal?: AbortSignal,
  ): Promise<void>;
  decode(bytes: Uint8Array, mimeType?: string, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number; channels: number; loudnessLufs?: number | null; loudnessRangeLu?: number | null; truePeakDbfs?: number | null }>;
  saveSonicDna(jobId: string, claimToken: string, dna: SonicDnaFeatures, signal?: AbortSignal): Promise<void>;
  analyzeVocals?(samples: Float32Array, sampleRate: number, channels: number, signal?: AbortSignal): Promise<VocalAnalysisResult>;
  generateAssessment(input: {
    evidence: Record<string, unknown>;
    sonicDna: Record<string, unknown> | null;
    catalogMetadata?: Record<string, unknown> | null;
  }, signal?: AbortSignal): Promise<ArAssessment>;
  saveAssessment(jobId: string, claimToken: string, assessment: ArAssessment, signal?: AbortSignal): Promise<void>;
  generateReport(input: AuditReportInput, tier: AuditReportTier, signal?: AbortSignal): Promise<Uint8Array>;
  saveReport(jobId: string, claimToken: string, tier: AuditReportTier, pdf: Uint8Array, reportInput?: AuditReportInput, signal?: AbortSignal): Promise<void>;
  markCompleted(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markFailed(jobId: string, claimToken: string, message: string, signal?: AbortSignal, errorCode?: AuditFailureCode): Promise<void>;
  stopHeartbeat?(): Promise<void>;
  signal?: AbortSignal;
}


function leaseLostError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_LEASE_LOST");
}

function assertLeaseActive(deps: AuditProcessorDependencies): void {
  if (deps.signal?.aborted) throw leaseLostError(deps.signal);
}

export const AI_ASSESSMENT_STAGE_TIMEOUT_MS = 10 * 60_000;
export const AUDIT_JOB_DEADLINE_MS = 20 * 60_000;

export type AuditFailureCode = "capacity" | "auth" | "malformed_output" | "timeout" | "provider_unavailable" | "processing_error";

export function classifyAuditFailure(error: unknown): AuditFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/AI_PROVIDERS_UNAVAILABLE|provider unavailable|provider_error|HTTP 5\d\d|service unavailable|bad gateway|gateway timeout|not configured|fetch failed|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(message)) return "provider_unavailable";
  if (/HTTP 401|HTTP 403|unauthorized|forbidden|authentication/i.test(message)) return "auth";
  if (/capacity|HTTP 413|HTTP 429|TPD|tokens per day|GROQ_REQUEST_TOO_LARGE/i.test(message)) return "capacity";
  if (/timed out|timeout|ETIMEDOUT|GROQ_ASSESSMENT_TIMEOUT|AUDIT_STAGE_TIMEOUT|AUDIT_JOB_DEADLINE_EXCEEDED/i.test(message)) return "timeout";
  if (/json_validate_failed|failed to validate JSON|Zod validation|malformed JSON|not valid JSON/i.test(message)) return "malformed_output";
  return "processing_error";
}

function userSafeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw === "AI capacity reached for now, please try again later") return raw;
  if (raw.startsWith("AUDIT_STAGE_TIMEOUT:")) {
    const stage = raw.slice("AUDIT_STAGE_TIMEOUT:".length);
    const messages: Record<string, string> = {
      catalog_lookup: "Catalog lookup: a submitted DSP link could not be checked within the time limit. Verify the link and retry.",
      catalog_persist: "Catalog lookup: the provider result could not be saved in time. Please retry the audit.",
      audio_download: "Audio intake: the uploaded master could not be retrieved in time. Re-upload the master and retry.",
      recognition_sample: "Audio recognition: the identification sample could not be prepared in time. Please retry.",
      audio_recognition: "Audio recognition: track identification did not finish in time. Please retry.",
      audio_decode: "Sonic DNA: the uploaded audio could not be decoded in time. Check the audio file and retry.",
      catalog_preview_recognition: "Catalog recognition: optional preview identification timed out; the audit can continue without it.",
      sonic_dna: "Sonic DNA: technical analysis exceeded its time limit. Please retry with a shorter or supported master.",
      ai_assessment: "AI assessment: the analysis exceeded its ten-minute time limit. Please retry later.",
      sample_pdf_generation: "Sample report: PDF generation exceeded its time limit. Please retry.",
      full_pdf_generation: "Full report: PDF generation exceeded its time limit. Please retry.",
      sample_pdf_persistence: "Sample report: the PDF could not be saved in time. Please retry.",
      full_pdf_persistence: "Full report: the PDF could not be saved in time. Please retry.",
    };
    return messages[stage] ?? "Audit processing: the " + stage.replace(/_/g, " ") + " stage exceeded its time limit. Please retry.";
  }
  if (raw === "GROQ_ASSESSMENT_TIMEOUT") return "AI assessment: one provider reached its allocated time limit; the configured fallback chain could not complete the assessment.";
  if (raw.startsWith("Combined audit is missing its uploaded master")) return "Audio intake: the combined audit is missing its uploaded master audio. Upload the master file and retry.";
  if (raw === "master unavailable") return "Audio intake: the uploaded master could not be retrieved. Re-upload it and retry.";
  if (raw.includes("evidenceGaps") || raw.includes("scorecard") || raw.includes("Zod validation")) return "AI assessment: the generated response did not meet the report's validation requirements. Please retry later.";
  if (raw.includes("TIDAL credentials unavailable") || raw.includes("provider credentials unavailable")) return "Catalog lookup: the provider credentials or connection are unavailable. Check the submitted link and retry.";
  if (raw.startsWith("GROQ_REQUEST_TOO_LARGE")) return "AI assessment: the request exceeded the supported input budget. Please retry later.";
  if (raw.startsWith("GROQ_PROMPT_BUDGET_EXCEEDED")) return "AI assessment: the evidence is too large to process safely in one request. Please retry with a smaller source set.";
  if (raw.includes("Zod validation") || raw.includes("json_validate_failed")) return "AI assessment: the generated response could not be validated. Please retry later.";
  return "Audit processing: a required stage could not be completed. Please retry the audit.";
}

async function awaitWithLease<T>(
  deps: AuditProcessorDependencies,
  operation: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  assertLeaseActive(deps);
  // Do not race the operation against the signal. A race can report the
  // processor as settled while provider, decoder, or storage work continues.
  // Every long-running dependency must receive and honor this signal.
  const result = await operation(deps.signal);
  assertLeaseActive(deps);
  return result;
}

const MEMORY_DIAGNOSTIC_STAGES = new Set([
  "audio_download",
  "audio_decode",
  "sonic_dna",
  "vocal_analysis",
  "ai_assessment",
  "sample_pdf_generation",
  "full_pdf_generation",
]);

function logStageMemory(stage: string, phase: "start" | "end"): void {
  const usage = process.memoryUsage();
  console.info(JSON.stringify({
    worker: "audit",
    event: "audit_stage_memory",
    stage,
    phase,
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  }));
}

async function awaitWithStage<T>(
  deps: AuditProcessorDependencies,
  stage: string,
  timeoutMs: number,
  operation: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  return await awaitWithLease(deps, async (leaseSignal) => {
    const captureMemory = MEMORY_DIAGNOSTIC_STAGES.has(stage);
    if (captureMemory) logStageMemory(stage, "start");
    let onAbort: (() => void) | undefined;
    const leaseAbort = leaseSignal ? new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(leaseSignal.reason instanceof Error ? leaseSignal.reason : new Error("AUDIT_LEASE_LOST"));
      if (leaseSignal.aborted) onAbort();
      else leaseSignal.addEventListener("abort", onAbort, { once: true });
    }) : new Promise<never>(() => undefined);
    try {
      return await Promise.race([
        withAbortTimeout(
          (timeoutSignal) => operation(leaseSignal ? AbortSignal.any([leaseSignal, timeoutSignal]) : timeoutSignal),
          timeoutMs,
          "AUDIT_STAGE_TIMEOUT:" + stage,
        ),
        leaseAbort,
      ]);
    } finally {
      if (onAbort && leaseSignal) leaseSignal.removeEventListener("abort", onAbort);
      if (captureMemory) logStageMemory(stage, "end");
    }
  });
}

function recognitionEvidence(recognition: AuditRecognition): Record<string, unknown> {
  if (!recognition.matched) {
    return {
      matched: false,
      confidence: null,
      source: "audd",
    };
  }

  return {
    matched: true,
    artist: recognition.artist ?? null,
    title: recognition.title ?? null,
    album: recognition.album ?? null,
    releaseDate: recognition.releaseDate ?? null,
    label: recognition.label ?? null,
    isrc: recognition.isrc ?? null,
    spotifyId: recognition.spotifyId ?? null,
    appleMusicId: recognition.appleMusicId ?? null,
    musicbrainzId: recognition.musicbrainzId ?? null,
    confidence: null,
    source: "audd",
    evidenceClass: "RECOGNIZED",
  };
}

function assessmentSafeCatalogMetadata(source: CatalogMetadata): CatalogMetadata | null {
  // Spotify Content and data derived from Spotify must not enter AI inputs.
  if (source.platform === "spotify") return null;

  const raw = source.raw && typeof source.raw === "object" ? source.raw : {};
  const crossReferences = raw.crossReferences && typeof raw.crossReferences === "object"
    ? raw.crossReferences as Record<string, unknown>
    : {};
  const hasSpotifyCrossReference =
    Object.prototype.hasOwnProperty.call(crossReferences, "spotify")
    || Boolean(source.externalIds?.spotify)
    || Object.keys(raw).some((key) => /spotify/i.test(key));
  if (!hasSpotifyCrossReference) return source;

  const safeCrossReferences = { ...crossReferences };
  delete safeCrossReferences.spotify;
  const safeExternalIds = { ...source.externalIds };
  delete safeExternalIds.spotify;
  return {
    ...source,
    // The TIDAL fallback previously populated these fields from Spotify.
    // Their field-level provenance is unavailable, so exclude them fail-closed.
    genre: null,
    catalogPopularity: null,
    catalogPopularityScale: null,
    externalIds: safeExternalIds,
    raw: { ...raw, crossReferences: safeCrossReferences },
  };
}

function assessmentCatalogMetadataInput(metadata: CatalogMetadata | readonly CatalogMetadata[]) {
  const sources: readonly CatalogMetadata[] = Array.isArray(metadata) ? metadata : [metadata as CatalogMetadata];
  const result: Record<string, unknown> = {};
  for (const original of sources) {
    const source = assessmentSafeCatalogMetadata(original);
    if (!source) continue;
    const fields = {
      title: source.title,
      artist: source.artist,
      album: source.album,
      isrc: source.isrc,
      upc: source.upc,
      label: source.label,
      releaseDate: source.releaseDate,
      genres: source.genre ? [source.genre] : [],
    };
    if (source.platform === "musicbrainz") result.musicbrainz = fields;
    if (source.platform === "tidal") result.tidal = fields;
    if (source.platform === "apple_music") result.apple_music = fields;
    if (source.platform === "deezer") result.deezer = fields;
    if (source.platform === "youtube_music") result.youtube_music = fields;
    if (source.platform === "audiomack") result.audiomack = fields;
  }
  return result;
}

function catalogMetadataInput(metadata: CatalogMetadata | readonly CatalogMetadata[]) {
  const sources: readonly CatalogMetadata[] = Array.isArray(metadata) ? metadata : [metadata as CatalogMetadata];
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    const fields = {
      title: source.title,
      artist: source.artist,
      album: source.album,
      isrc: source.isrc,
      upc: source.upc,
      label: source.label,
      releaseDate: source.releaseDate,
      genres: source.genre ? [source.genre] : [],
    };
    if (source.platform === "spotify") result.spotify = fields;
    if (source.platform === "musicbrainz") result.musicbrainz = fields;
    if (source.platform === "tidal") result.tidal = fields;
    if (source.platform === "apple_music") result.apple_music = fields;
    if (source.platform === "deezer") result.deezer = fields;
    if (source.platform === "youtube_music") result.youtube_music = fields;
    if (source.platform === "audiomack") result.audiomack = fields;
  }
  return result;
}

function genreProviderTags(metadataSources: readonly CatalogMetadata[], masterTags: ReturnType<typeof readAudioTags> | null): ProviderGenreTags[] {
  const result: ProviderGenreTags[] = [];
  for (const source of metadataSources) {
    // Reuse the existing fail-closed Spotify provenance filter. TIDAL's
    // provider-reported sonic profile remains a separate source.
    const safe = assessmentSafeCatalogMetadata(source);
    if (!safe) continue;
    const tags = [...new Set([
      safe.genre,
      ...(safe.sonicProfile?.genreContext ?? []),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
    if (tags.length) result.push({ provider: source.platform, tags });
  }
  if (masterTags?.genres.length) result.push({ provider: "id3", tags: masterTags.genres });
  return result;
}

function recognitionMetadataInput(recognition: AuditRecognition) {
  return {
    matched: recognition.matched,
    result: {
      title: recognition.title,
      artist: recognition.artist,
      album: recognition.album,
      isrc: recognition.isrc,
      label: recognition.label,
      releaseDate: recognition.releaseDate,
    },
  };
}

function identityEvidence(identity: TrackIdentity): Record<string, unknown> {
  return {
    title: identity.title,
    artist: identity.artist,
    album: identity.album,
    releaseDate: identity.releaseDate,
    label: identity.label,
    isrc: identity.isrc,
    upc: identity.upc,
    genres: identity.genres,
    sourceProviders: identity.sourceProviders,
    fieldProvenance: identity.fieldProvenance,
  };
}

function catalogLookupReason(status: string): string {
  if (status === "recognized") return "Provider returned track metadata.";
  if (status === "partial") return "Provider returned incomplete metadata; some identity fields remain unresolved.";
  if (status === "unavailable") return "Provider could not verify this submitted link.";
  return "Provider lookup is pending.";
}

function reconciliationEvidence(reconciliation: MetadataReconciliation): Record<string, unknown> {
  return {
    status: reconciliation.status,
    evidenceClass: reconciliation.status === "reconciled"
      ? "RECONCILED"
      : reconciliation.identity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
    reconciledFields: reconciliation.reconciledFields,
    conflicts: reconciliation.conflicts,
    identity: identityEvidence(reconciliation.identity),
  };
}

function catalogEvidence(metadata: CatalogMetadata, identity: TrackIdentity): Record<string, unknown> {
  return {
    auditType: "METADATA-BASED AUDIT",
    status: metadata.evidenceStatus,
    platform: metadata.platform,
    artist: metadata.artist,
    title: metadata.title,
    album: metadata.album,
    releaseDate: metadata.releaseDate,
    isrc: metadata.isrc,
    upc: metadata.upc,
    label: metadata.label,
    genre: metadata.genre,
    externalIds: metadata.externalIds,
    canonicalUrl: metadata.canonicalUrl,
    source: metadata.platform,
    evidenceClass: identity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
    identity: identityEvidence(identity),
    catalogPopularity: metadata.catalogPopularity,
    catalogPopularityScale: metadata.catalogPopularityScale,
    sonicProfile: metadata.sonicProfile,
  };
}

function catalogSonicDna(metadata: CatalogMetadata): Record<string, unknown> | null {
  if (!metadata.sonicProfile) return null;
  return {
    provenance: metadata.sonicProfile.provenance,
    evidenceClass: "RECOGNIZED",
    sampleRate: null,
    channels: null,
    durationSeconds: null,
    bpm: metadata.sonicProfile.bpm,
    key: metadata.sonicProfile.key,
    mode: metadata.sonicProfile.mode,
    loudnessLufs: null,
    rmsLevelDbfs: null,
    rmsEnergy: null,
    dynamicRangeDb: null,
    spectralCentroidHz: null,
    spectralBandwidthHz: null,
    spectralRolloffHz: null,
    zeroCrossingRate: null,
    moodTags: metadata.sonicProfile.moodTags,
    genreContext: metadata.sonicProfile.genreContext,
  };
}

function dnaEvidence(dna: SonicDnaFeatures): Record<string, unknown> {
  return {
    provenance: "uploaded_audio_master",
    evidenceClass: "OBSERVED",
    sampleRate: dna.sampleRate,
    channels: dna.channels,
    durationSeconds: dna.durationSeconds,
    bpm: dna.bpm,
    alternateTempo: dna.alternateTempo,
    tempoConfidence: dna.tempoConfidence,
    key: dna.key,
    mode: dna.mode,
    keyConfidence: dna.keyConfidence,
    keyTuningCents: dna.keyTuningCents,
    keySegmentAgreement: dna.keySegmentAgreement,
    keyAnalysisFftButterflyCount: dna.keyAnalysisFftButterflyCount,
    limitations: dna.limitations,
    loudnessLufs: dna.loudnessLufs,
    loudnessRangeLu: dna.loudnessRangeLu ?? null,
    truePeakDbfs: dna.truePeakDbfs ?? null,
    rmsLevelDbfs: dna.rmsLevelDbfs,
    rmsEnergy: dna.rmsEnergy,
    dynamicRangeDb: dna.dynamicRangeDb,
    spectralCentroidHz: dna.spectralCentroidHz,
    spectralBandwidthHz: dna.spectralBandwidthHz,
    spectralRolloffHz: dna.spectralRolloffHz,
    zeroCrossingRate: dna.zeroCrossingRate,
    rhythmFeatures: dna.rhythmFeatures,
    harmonicFeatures: dna.harmonicFeatures,
    vocalFeatures: dna.vocalFeatures,
    moodTags: dna.moodTags,
    genreContext: dna.genreContext,
    ...(dna.genreClassification ? { genreClassification: dna.genreClassification } : {}),
  };
}

async function generateAndSaveReport(
  jobId: string,
  claimToken: string,
  reportInput: AuditReportInput,
  tier: AuditReportTier,
  deps: AuditProcessorDependencies,
): Promise<void> {
  const pdf = await awaitWithStage(deps, tier + "_pdf_generation", 90_000, (signal) => deps.generateReport(reportInput, tier, signal));
  if (!isPdf(pdf)) throw new Error(`${tier} report generator did not return a PDF`);
  await awaitWithStage(deps, tier + "_pdf_persistence", 45_000, (signal) => deps.saveReport(jobId, claimToken, tier, pdf, tier === "full" ? reportInput : undefined, signal));
}

export async function processAuditJob(
  jobId: string,
  deps: AuditProcessorDependencies,
): Promise<{ status: "completed" | "failed" }> {
  const job = await awaitWithLease(deps, (signal) => deps.getJob(jobId, signal));
  if (!job) throw new Error("Audit job not found");
  if (job.status !== "processing") throw new Error(`Audit job is not actively claimed: ${job.status}`);
  const previousSignal = deps.signal;
  const jobDeadlineController = new AbortController();
  const jobDeadlineTimer = setTimeout(() => jobDeadlineController.abort(new Error("AUDIT_JOB_DEADLINE_EXCEEDED")), AUDIT_JOB_DEADLINE_MS);
  deps.signal = previousSignal ? AbortSignal.any([previousSignal, jobDeadlineController.signal]) : jobDeadlineController.signal;

  try {
    await awaitWithStage(deps, "job_start", 15_000, (signal) => deps.markProcessing(jobId, job.claimToken, signal));

    const sourceReadinessError = getAuditSourceReadinessError(job);
    if (sourceReadinessError) throw new Error(sourceReadinessError);
    const hasMaster = Boolean(job.sourceAudioPath && job.mimeType);
    const hasCatalog = Boolean(job.catalogUrls?.some((url) => url.trim()) || job.catalogUrl?.trim());
    if (!hasMaster && !hasCatalog) throw new Error("Audit job has no usable source");

    let metadata: CatalogMetadata | undefined;
    let metadataSources: CatalogMetadata[] = [];
    let catalogResults: DspMetadataResult[] = [];
    if (hasCatalog) {
      const links = normalizeDspTrackLinks(job.catalogUrls?.length ? job.catalogUrls : [job.catalogUrl!]);
      catalogResults = await awaitWithStage(deps, "catalog_lookup", 45_000, (signal) =>
        collectDspMetadata(links, { collect: deps.collectCatalogMetadata }, signal),
      );
      metadataSources = catalogResults.flatMap((result) => result.status !== "unavailable" && result.metadata ? [result.metadata] : []);
      // Persist failures first so the final successful catalog write, when present,
      // remains the job row's latest raw metadata snapshot.
      for (const result of catalogResults) {
        if (result.status === "unavailable" && result.error && deps.saveCatalogFailure) {
          await awaitWithStage(deps, "catalog_persist", 15_000, (signal) =>
            deps.saveCatalogFailure!(jobId, job.claimToken, result.link, result.error!, signal),
          );
        }
      }
      for (const result of catalogResults) {
        if (result.status !== "unavailable" && result.metadata) {
          await awaitWithStage(deps, "catalog_persist", 15_000, (signal) =>
            deps.saveCatalogMetadata(jobId, job.claimToken, result.metadata!, signal),
          );
        }
      }
      if (!metadataSources.length && !hasMaster) {
        const failures = catalogResults.map((result) => result.error).filter(Boolean).join("; ");
        throw new Error(failures || "No DSP provider returned usable track metadata");
      }
      metadata = metadataSources[0];
    }

    let masterDna: SonicDnaFeatures | null = null;
    let decodedMaster: Awaited<ReturnType<AuditProcessorDependencies["decode"]>> | null = null;
    let masterRecognition: AuditRecognition | null = null;
    let masterTags: ReturnType<typeof readAudioTags> | null = null;
    const attemptedRecognitionProviders = new Set<string>();
    if (hasMaster) {
      const master = await awaitWithStage(deps, "audio_download", 30_000, (signal) => deps.downloadMaster(job.sourceAudioPath!, signal));
      masterTags = readAudioTags(master);
      const sample = await awaitWithStage(deps, "recognition_sample", 30_000, (signal) => deps.createRecognitionSample(master, job.mimeType!, signal));
      masterRecognition = await awaitWithStage(deps, "audio_recognition", 45_000, (signal) => {
        attemptedRecognitionProviders.add("audd");
        return deps.recognize(sample, signal);
      });
      const decoded = await awaitWithStage(deps, "audio_decode", 90_000, (signal) => deps.decode(master, job.mimeType!, signal));
      const dna = await awaitWithStage(deps, "sonic_dna", 90_000, (signal) =>
        analyzePcmWithTimeout(decoded.samples, decoded.sampleRate, decoded.channels, 90_000, signal),
      );
      decodedMaster = decoded;
      masterDna = {
        ...dna,
        loudnessLufs: decoded.loudnessLufs ?? dna.loudnessLufs,
        loudnessRangeLu: decoded.loudnessRangeLu ?? null,
        truePeakDbfs: decoded.truePeakDbfs ?? null,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        durationSeconds: Math.floor(decoded.samples.length / Math.max(1, decoded.channels)) / decoded.sampleRate,
      };
      // Persist the completed measurement before optional, memory-intensive vocal
      // separation. A worker OOM during vocal analysis must not erase Sonic DNA.
      await awaitWithStage(deps, "sonic_dna_persist", 15_000, (signal) =>
        deps.saveSonicDna(jobId, job.claimToken, masterDna!, signal),
      );
    }

    let catalogRecognition: AuditRecognition | null = null;
    const previewMetadata = metadataSources.find((source) => source.previewUrl);
    if (previewMetadata?.previewUrl) {
      try {
        catalogRecognition = await awaitWithStage(deps, "catalog_preview_recognition", 30_000, (signal) => {
          attemptedRecognitionProviders.add("audd");
          return deps.recognizeUrl(previewMetadata.previewUrl!, signal);
        });
      } catch (error) {
        if (deps.signal?.aborted) throw leaseLostError(deps.signal);
        // Optional preview recognition must not block catalog-only or combined analysis.
      }
    }

    const recognition: AuditRecognition = masterRecognition?.matched
      ? masterRecognition
      : catalogRecognition?.matched
        ? catalogRecognition
        : masterRecognition ?? catalogRecognition ?? { matched: false };
    if (masterRecognition || catalogRecognition) {
      await awaitWithStage(deps, "recognition_persist", 15_000, (signal) => deps.saveRecognition(jobId, job.claimToken, recognition, signal));
    }

    let isrcLookup: IsrcCatalogLookup | null = null;
    const isrcCandidate = (recognition.matched ? recognition.isrc : null) ?? metadataSources.find((source) => source.isrc)?.isrc ?? null;
    let normalizedIsrc: string | null = null;
    if (isrcCandidate) {
      try { normalizedIsrc = normalizeIsrc(isrcCandidate); }
      catch { normalizedIsrc = null; }
    }
    const isrcLookupAvailable = Boolean(
      deps.collectIsrcCatalogMetadata
      || providerDecision("musicbrainz").enabled
      || (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && providerDecision("spotify").enabled),
    );
    if (normalizedIsrc && isrcLookupAvailable) {
      isrcLookup = await awaitWithStage(deps, "isrc_catalog_lookup", 30_000, (signal) =>
        (deps.collectIsrcCatalogMetadata ?? collectIsrcCatalogMetadata)(normalizedIsrc!, signal),
      );
      for (const source of isrcLookup.metadata) {
        if (!metadataSources.some((existing) => existing.platform === source.platform && existing.catalogId === source.catalogId)) {
          metadataSources.push(source);
          await awaitWithStage(deps, "catalog_persist", 15_000, (signal) =>
            deps.saveCatalogMetadata(jobId, job.claimToken, source, signal),
          );
        }
      }
      metadata = metadata ?? metadataSources[0];
    }

    if (masterDna && decodedMaster) {
      let vocalFeatures: VocalAnalysisResult;
      if (deps.analyzeVocals) {
        try {
          vocalFeatures = await awaitWithStage(deps, "vocal_analysis", 150_000, (signal) =>
            deps.analyzeVocals!(decodedMaster!.samples, decodedMaster!.sampleRate, decodedMaster!.channels, signal),
          );
        } catch (error) {
          if (deps.signal?.aborted) throw leaseLostError(deps.signal);
          vocalFeatures = unavailableVocalAnalysis(error instanceof Error ? error.message : "Vocal analysis did not complete.");
        }
      } else {
        vocalFeatures = unavailableVocalAnalysis("Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.");
      }
      masterDna = {
        ...masterDna,
        vocalFeatures: vocalFeatures as unknown as Record<string, unknown>,
        limitations: [...masterDna.limitations, ...vocalFeatures.limitations],
      };
      // The vocal worker now owns the decoded PCM allocation. Do not retain
      // the detached sample view through the report/reconciliation stages.
      decodedMaster = null;
    }

    const metadataInput = {
      ...(metadataSources.length ? catalogMetadataInput(metadataSources) : {}),
      ...(masterTags ? { id3: masterTags } : {}),
      ...(job.filename ? { filename: job.filename } : {}),
      audd: recognitionMetadataInput(recognition),
    };
    const reconciliation = reconcileMetadata(metadataInput);

    const fusedGenreClassification = fuseGenreEvidence({
      providerTags: genreProviderTags(metadataSources, masterTags),
      bpm: masterDna?.bpm ?? null,
      tempoConfidence: masterDna?.tempoConfidence ?? null,
    });
    const genreModelResult = await DEFAULT_GENRE_MODEL.classify({
      bpm: masterDna?.bpm ?? null,
      tempoConfidence: masterDna?.tempoConfidence ?? null,
      key: masterDna?.key ?? null,
      mode: masterDna?.mode ?? null,
      providerGenreIds: fusedGenreClassification.genres.map((genre) => genre.id),
    });
    const genreClassification = { ...fusedGenreClassification, model: genreModelResult };
    if (masterDna) {
      masterDna = {
        ...masterDna,
        genreClassification,
        genreContext: genreClassification.genres.map((genre) => genre.label),
      };
      await awaitWithStage(deps, "sonic_dna_persist", 15_000, (signal) => deps.saveSonicDna(jobId, job.claimToken, masterDna!, signal));
    }

    // A submitted audio master must have durable Sonic DNA before reconciliation
    // is persisted. This keeps the stored evidence chain in the same order as
    // the actual processing prerequisites and prevents reconciliation from
    // appearing complete while the required audio measurement is still pending.
    if (hasMaster && !masterDna) {
      throw new Error("SONIC_DNA_REQUIRED_BEFORE_RECONCILIATION");
    }
    await awaitWithStage(deps, "evidence_reconciliation_persist", 15_000, (signal) =>
      deps.saveEvidence(jobId, job.claimToken, recognition, reconciliation, metadata, signal, metadataSources),
    );

    const identity = reconciliation.identity;
    const evidence = {
      ...(metadata ? catalogEvidence(metadata, identity) : { auditType: "MASTER-BASED AUDIT" }),
      auditType: hasMaster && hasCatalog ? "COMBINED MASTER + DSP AUDIT" : hasCatalog ? "METADATA-BASED AUDIT" : "MASTER-BASED AUDIT",
      ...recognitionEvidence(recognition),
      ...identityEvidence(identity),
      evidenceClass: reconciliation.status === "reconciled"
        ? "RECONCILED"
        : identity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
      identity: identityEvidence(identity),
      reconciliation: reconciliationEvidence(reconciliation),
      genreClassification,
      metadataSourcesChecked: [...catalogResults.map((result) => result.link.platform), ...(isrcLookup?.outcomes.map((outcome) => outcome.provider) ?? []), ...(masterTags ? ["id3"] : []), ...(job.filename ? ["filename"] : []), ...attemptedRecognitionProviders],
      catalogSources: [
        ...catalogResults.map((result) => ({ platform: result.link.platform, catalogId: result.link.catalogId, canonicalUrl: result.link.canonicalUrl, status: result.status, reason: catalogLookupReason(result.status) })),
        ...(isrcLookup?.outcomes.map((outcome) => ({ platform: outcome.provider, catalogId: isrcLookup?.isrc ?? null, canonicalUrl: outcome.provider === "musicbrainz" ? `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrcLookup!.isrc)}` : null, status: outcome.status === "not_configured" ? "unavailable" : outcome.status, reason: outcome.reason })) ?? []),
      ],
      sourceCombination: hasMaster && hasCatalog ? "master_and_dsp" : hasMaster ? "master_only" : "dsp_only",
      ...(hasMaster ? { masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } } : {}),
    };
    const assessmentMetadataSources = metadataSources
      .map(assessmentSafeCatalogMetadata)
      .filter((source): source is CatalogMetadata => source !== null);
    const assessmentMetadata = assessmentMetadataSources[0] ?? undefined;
    const assessmentMetadataInput = {
      ...assessmentCatalogMetadataInput(metadataSources),
      ...(masterTags ? { id3: masterTags } : {}),
      ...(job.filename ? { filename: job.filename } : {}),
      audd: recognitionMetadataInput(recognition),
    };
    const assessmentReconciliation = reconcileMetadata(assessmentMetadataInput);
    const conflictedFields = new Set(assessmentReconciliation.conflicts.map((conflict) => conflict.field));
    const sourceIdentity = assessmentReconciliation.identity;
    const assessmentIdentity: TrackIdentity = Object.freeze({
      ...sourceIdentity,
      title: conflictedFields.has("title") ? null : sourceIdentity.title,
      artist: conflictedFields.has("artist") ? null : sourceIdentity.artist,
      album: conflictedFields.has("album") ? null : sourceIdentity.album,
      isrc: conflictedFields.has("isrc") ? null : sourceIdentity.isrc,
      upc: conflictedFields.has("upc") ? null : sourceIdentity.upc,
      label: conflictedFields.has("label") ? null : sourceIdentity.label,
      releaseDate: conflictedFields.has("releaseDate") ? null : sourceIdentity.releaseDate,
      fieldProvenance: Object.freeze({
        ...sourceIdentity.fieldProvenance,
        title: conflictedFields.has("title") ? null : sourceIdentity.fieldProvenance.title,
        artist: conflictedFields.has("artist") ? null : sourceIdentity.fieldProvenance.artist,
        album: conflictedFields.has("album") ? null : sourceIdentity.fieldProvenance.album,
        isrc: conflictedFields.has("isrc") ? null : sourceIdentity.fieldProvenance.isrc,
        upc: conflictedFields.has("upc") ? null : sourceIdentity.fieldProvenance.upc,
        label: conflictedFields.has("label") ? null : sourceIdentity.fieldProvenance.label,
        releaseDate: conflictedFields.has("releaseDate") ? null : sourceIdentity.fieldProvenance.releaseDate,
      }),
    });
    const assessmentReconciliationEvidence = {
      status: assessmentReconciliation.status,
      evidenceClass: assessmentReconciliation.status === "reconciled"
        ? "RECONCILED"
        : assessmentIdentity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
      reconciledFields: assessmentReconciliation.reconciledFields,
      conflicts: assessmentReconciliation.conflicts,
      identity: identityEvidence(assessmentIdentity),
    };
    const assessmentRecognition = recognitionEvidence(recognition);
    delete assessmentRecognition.spotifyId;
    const assessmentEvidence = {
      ...(assessmentMetadata ? catalogEvidence(assessmentMetadata, assessmentIdentity) : { auditType: evidence.auditType }),
      ...assessmentRecognition,
      ...identityEvidence(assessmentIdentity),
      evidenceClass: assessmentReconciliation.status === "reconciled"
        ? "RECONCILED"
        : assessmentIdentity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
      identity: identityEvidence(assessmentIdentity),
      reconciliation: assessmentReconciliationEvidence,
      genreClassification,
      metadataSourcesChecked: [
        ...catalogResults.filter((result) => result.link.platform !== "spotify").map((result) => result.link.platform),
        ...(isrcLookup?.outcomes.filter((outcome) => outcome.provider !== "spotify").map((outcome) => outcome.provider) ?? []),
        ...(masterTags ? ["id3"] : []),
        ...(job.filename ? ["filename"] : []),
        ...attemptedRecognitionProviders,
      ],
      catalogSources: [
        ...catalogResults.filter((result) => result.link.platform !== "spotify")
          .map((result) => ({ platform: result.link.platform, catalogId: result.link.catalogId, canonicalUrl: result.link.canonicalUrl, status: result.status, reason: catalogLookupReason(result.status) })),
        ...(isrcLookup?.outcomes.filter((outcome) => outcome.provider !== "spotify").map((outcome) => ({ platform: outcome.provider, catalogId: isrcLookup?.isrc ?? null, canonicalUrl: `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrcLookup!.isrc)}`, status: outcome.status === "not_configured" ? "unavailable" : outcome.status, reason: outcome.reason })) ?? []),
      ],
      sourceCombination: evidence.sourceCombination,
      ...(hasMaster ? { masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } } : {}),
    };
    const sonicDnaBase = masterDna
      ? dnaEvidence(masterDna)
      : assessmentMetadata
        ? catalogSonicDna(assessmentMetadata)
        : null;
    const sonicDna = sonicDnaBase ? {
      ...sonicDnaBase,
      genreClassification,
      genreContext: genreClassification.genres.map((genre) => genre.label),
    } : null;
    const assessment = await awaitWithStage(deps, "ai_assessment", AI_ASSESSMENT_STAGE_TIMEOUT_MS, (signal) => deps.generateAssessment({
      evidence: assessmentEvidence,
      sonicDna,
      catalogMetadata: assessmentMetadata
        ? {
            ...catalogEvidence(assessmentMetadata, assessmentIdentity),
            ...identityEvidence(assessmentIdentity),
            identity: identityEvidence(assessmentIdentity),
            reconciliation: assessmentReconciliationEvidence,
            catalogSources: assessmentEvidence.catalogSources,
          }
        : null,
    }, signal));
    await awaitWithStage(deps, "assessment_persist", 15_000, (signal) => deps.saveAssessment(jobId, job.claimToken, assessment, signal));

    let playlistDiscovery: PlaylistDiscoveryResult | null = null;
    if (normalizedIsrc && deps.discoverPlaylists) {
      const providerMoodTags = metadataSources.flatMap((source) => source.sonicProfile?.moodTags ?? []);
      const playlistInput: PlaylistDiscoveryInput = {
        isrc: normalizedIsrc,
        artist: assessmentIdentity.artist ?? identity.artist,
        title: assessmentIdentity.title ?? identity.title,
        primaryGenre: genreClassification.primaryGenre,
        adjacentLanes: genreClassification.adjacentLanes,
        moodTags: [...new Set(providerMoodTags)],
      };
      try {
        playlistDiscovery = await awaitWithStage(deps, "playlist_discovery", 25_000, (signal) =>
          deps.discoverPlaylists!(playlistInput, signal),
        );
      } catch (error) {
        if (deps.signal?.aborted) throw leaseLostError(deps.signal);
        playlistDiscovery = {
          status: "unavailable",
          candidates: [],
          outcomes: [{ provider: "spotify", status: "unavailable", reason: error instanceof Error ? error.message.slice(0, 180) : "Playlist discovery was unavailable." }],
        };
      }
    }
    const reportEvidence = playlistDiscovery ? { ...evidence, playlistDiscovery } : evidence;
    const generatedAt = new Date().toISOString();
    const reportInput = { auditId: jobId, generatedAt, evidence: reportEvidence, sonicDna, assessment };
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "sample", deps);
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "full", deps);

    await awaitWithStage(deps, "job_completion", 15_000, (signal) => deps.markCompleted(jobId, job.claimToken, signal));
    return { status: "completed" };
  } catch (error) {
    const jobDeadlineExceeded = jobDeadlineController.signal.aborted && !previousSignal?.aborted;
    if (deps.signal?.aborted && !jobDeadlineExceeded) throw leaseLostError(deps.signal);
    const message = jobDeadlineExceeded
      ? "Audit processing: the job exceeded its twenty-minute safety deadline. Please submit it again."
      : userSafeFailureMessage(error);
    const errorCode = classifyAuditFailure(error);
    await withAbortTimeout(
      (signal) => deps.markFailed(jobId, job.claimToken, message, signal, errorCode),
      15_000,
      "AUDIT_TERMINAL_WRITE_TIMEOUT",
    );
    return { status: "failed" };
  } finally {
    // Keep renewing the lease until the terminal database write has settled.
    // Otherwise a slow completion/failure RPC can strand the row in processing
    // after its heartbeat is stopped.
    try { await deps.stopHeartbeat?.(); }
    finally {
      clearTimeout(jobDeadlineTimer);
      deps.signal = previousSignal;
    }
  }
}
