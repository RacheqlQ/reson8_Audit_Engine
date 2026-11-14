import type { AuditRecognition } from "../providers/audd/normalize.js";
import type { CatalogMetadata } from "../providers/dsp/catalog.js";
import type { ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
import { isPdf } from "../reports/pdf-output.js";
import { analyzePcm, type SonicDnaFeatures } from "../audio/sonic-dna.js";
import type { TrackIdentity } from "../metadata/MetadataEngine.js";
import { reconcileMetadata, type MetadataReconciliation } from "../metadata/ReconciliationEngine.js";

export interface AuditJobRecord {
  id: string;
  ownerId: string | null;
  sourceAudioPath: string | null;
  mimeType: string | null;
  sourceType: "master" | "dsp_link" | "combined";
  catalogUrl: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  claimToken: string;
  leaseExpiresAt: string;
  workerId: string;
}

export interface AuditProcessorDependencies {
  getJob(jobId: string, signal?: AbortSignal): Promise<AuditJobRecord | null>;
  markProcessing(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  collectCatalogMetadata(url: string, signal?: AbortSignal): Promise<CatalogMetadata>;
  recognizeUrl(url: string, signal?: AbortSignal): Promise<AuditRecognition>;
  downloadMaster(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  createRecognitionSample(master: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<Uint8Array>;
  recognize(sample: Uint8Array, signal?: AbortSignal): Promise<AuditRecognition>;
  saveRecognition(jobId: string, claimToken: string, recognition: AuditRecognition, signal?: AbortSignal): Promise<void>;
  saveEvidence(jobId: string, claimToken: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  saveCatalogMetadata(jobId: string, claimToken: string, metadata: CatalogMetadata, signal?: AbortSignal): Promise<void>;
  decode(bytes: Uint8Array, mimeType?: string, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number; channels: number }>;
  saveSonicDna(jobId: string, claimToken: string, dna: SonicDnaFeatures, signal?: AbortSignal): Promise<void>;
  generateAssessment(input: {
    evidence: Record<string, unknown>;
    sonicDna: Record<string, unknown> | null;
    catalogMetadata?: Record<string, unknown> | null;
  }, signal?: AbortSignal): Promise<ArAssessment>;
  saveAssessment(jobId: string, claimToken: string, assessment: ArAssessment, signal?: AbortSignal): Promise<void>;
  generateReport(input: AuditReportInput, tier: AuditReportTier, signal?: AbortSignal): Promise<Uint8Array>;
  saveReport(jobId: string, claimToken: string, tier: AuditReportTier, pdf: Uint8Array, reportInput?: AuditReportInput, signal?: AbortSignal): Promise<void>;
  markCompleted(jobId: string, claimToken: string, signal?: AbortSignal): Promise<void>;
  markFailed(jobId: string, claimToken: string, message: string, signal?: AbortSignal): Promise<void>;
  stopHeartbeat?(): Promise<void>;
  signal?: AbortSignal;
}


function leaseLostError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_LEASE_LOST");
}

function assertLeaseActive(deps: AuditProcessorDependencies): void {
  if (deps.signal?.aborted) throw leaseLostError(deps.signal);
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

function catalogMetadataInput(metadata: CatalogMetadata) {
  const fields = {
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          isrc: metadata.isrc,
          label: metadata.label,
          releaseDate: metadata.releaseDate,
          genres: metadata.genre ? [metadata.genre] : [],
  };
  if (metadata.platform === "spotify") return { spotify: fields };
  if (metadata.platform === "tidal") return { tidal: fields };
  if (metadata.platform === "apple_music") return { apple_music: fields };
  if (metadata.platform === "deezer") return { deezer: fields };
  if (metadata.platform === "youtube_music") return { youtube_music: fields };
  return {};
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
    genres: identity.genres,
    sourceProviders: identity.sourceProviders,
  };
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
    limitations: dna.limitations,
    loudnessLufs: dna.loudnessLufs,
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
  };
}

async function generateAndSaveReport(
  jobId: string,
  claimToken: string,
  reportInput: AuditReportInput,
  tier: AuditReportTier,
  deps: AuditProcessorDependencies,
): Promise<void> {
  const pdf = await awaitWithLease(deps, (signal) => deps.generateReport(reportInput, tier, signal));
  if (!isPdf(pdf)) throw new Error(`${tier} report generator did not return a PDF`);
  await awaitWithLease(
    deps,
    (signal) => deps.saveReport(jobId, claimToken, tier, pdf, tier === "full" ? reportInput : undefined, signal),
  );
}

export async function processAuditJob(
  jobId: string,
  deps: AuditProcessorDependencies,
): Promise<{ status: "completed" | "failed" }> {
  const job = await awaitWithLease(deps, (signal) => deps.getJob(jobId, signal));
  if (!job) throw new Error("Audit job not found");
  if (job.status !== "processing") throw new Error(`Audit job is not actively claimed: ${job.status}`);

  try {
    await awaitWithLease(deps, (signal) => deps.markProcessing(jobId, job.claimToken, signal));

    const hasMaster = Boolean(job.sourceAudioPath && job.mimeType);
    const hasCatalog = Boolean(job.catalogUrl);
    if (!hasMaster && !hasCatalog) throw new Error("Audit job has no usable source");

    let metadata: CatalogMetadata | undefined;
    if (hasCatalog) {
      metadata = await awaitWithLease(deps, (signal) => deps.collectCatalogMetadata(job.catalogUrl!, signal));
      await awaitWithLease(deps, (signal) => deps.saveCatalogMetadata(jobId, job.claimToken, metadata!, signal));
    }

    let masterDna: SonicDnaFeatures | null = null;
    let masterRecognition: AuditRecognition | null = null;
    if (hasMaster) {
      const master = await awaitWithLease(deps, (signal) => deps.downloadMaster(job.sourceAudioPath!, signal));
      const sample = await awaitWithLease(deps, (signal) => deps.createRecognitionSample(master, job.mimeType!, signal));
      masterRecognition = await awaitWithLease(deps, (signal) => deps.recognize(sample, signal));
      const decoded = await awaitWithLease(deps, (signal) => deps.decode(master, job.mimeType!, signal));
      const dna = analyzePcm(decoded.samples, decoded.sampleRate, decoded.channels);
      masterDna = {
        ...dna,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        durationSeconds: Math.floor(decoded.samples.length / Math.max(1, decoded.channels)) / decoded.sampleRate,
      };
      await awaitWithLease(deps, (signal) => deps.saveSonicDna(jobId, job.claimToken, masterDna!, signal));
    }

    let catalogRecognition: AuditRecognition | null = null;
    if (metadata?.previewUrl) {
      try {
        catalogRecognition = await awaitWithLease(deps, (signal) => deps.recognizeUrl(metadata!.previewUrl!, signal));
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
      await awaitWithLease(deps, (signal) => deps.saveRecognition(jobId, job.claimToken, recognition, signal));
    }

    const metadataInput = {
      ...(metadata ? catalogMetadataInput(metadata) : {}),
      audd: recognitionMetadataInput(recognition),
    };
    const reconciliation = reconcileMetadata(metadataInput);
    await awaitWithLease(deps, (signal) => deps.saveEvidence(jobId, job.claimToken, recognition, reconciliation, metadata, signal));

    const identity = reconciliation.identity;
    const evidence = {
      ...(metadata ? catalogEvidence(metadata, identity) : { auditType: "MASTER-BASED AUDIT" }),
      ...recognitionEvidence(recognition),
      ...identityEvidence(identity),
      evidenceClass: reconciliation.status === "reconciled"
        ? "RECONCILED"
        : identity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
      identity: identityEvidence(identity),
      reconciliation: reconciliationEvidence(reconciliation),
      sourceCombination: hasMaster && hasCatalog ? "master_and_dsp" : hasMaster ? "master_only" : "dsp_only",
      ...(hasMaster ? { masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } } : {}),
    };
    const sonicDna = masterDna
      ? dnaEvidence(masterDna)
      : metadata
        ? catalogSonicDna(metadata)
        : null;
    const assessment = await awaitWithLease(deps, (signal) => deps.generateAssessment({
      evidence,
      sonicDna,
      catalogMetadata: metadata ? catalogEvidence(metadata, identity) : null,
    }, signal));
    await awaitWithLease(deps, (signal) => deps.saveAssessment(jobId, job.claimToken, assessment, signal));

    const generatedAt = new Date().toISOString();
    const reportInput = { auditId: jobId, generatedAt, evidence, sonicDna, assessment };
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "sample", deps);
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "full", deps);

    await deps.stopHeartbeat?.();
    await awaitWithLease(deps, (signal) => deps.markCompleted(jobId, job.claimToken, signal));
    return { status: "completed" };
  } catch (error) {
    if (deps.signal?.aborted) throw leaseLostError(deps.signal);
    const message = error instanceof Error ? error.message : "Unknown processing error";
    try {
      await deps.stopHeartbeat?.();
    } catch (stopError) {
      if (deps.signal?.aborted) throw leaseLostError(deps.signal);
      throw stopError;
    }
    await awaitWithLease(deps, (signal) => deps.markFailed(jobId, job.claimToken, message, signal));
    return { status: "failed" };
  }
}
