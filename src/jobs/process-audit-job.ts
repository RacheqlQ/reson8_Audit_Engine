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
  sourceType: "master" | "dsp_link";
  catalogUrl: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  claimToken: string;
  leaseExpiresAt: string;
  workerId: string;
}

export interface AuditProcessorDependencies {
  getJob(jobId: string): Promise<AuditJobRecord | null>;
  markProcessing(jobId: string, claimToken: string): Promise<void>;
  collectCatalogMetadata(url: string): Promise<CatalogMetadata>;
  recognizeUrl(url: string): Promise<AuditRecognition>;
  downloadMaster(path: string): Promise<Uint8Array>;
  createRecognitionSample(master: Uint8Array, mimeType: string): Promise<Uint8Array>;
  recognize(sample: Uint8Array): Promise<AuditRecognition>;
  saveRecognition(jobId: string, claimToken: string, recognition: AuditRecognition): Promise<void>;
  saveEvidence(jobId: string, claimToken: string, recognition: AuditRecognition, reconciliation: MetadataReconciliation, metadata?: CatalogMetadata): Promise<void>;
  saveCatalogMetadata(jobId: string, claimToken: string, metadata: CatalogMetadata): Promise<void>;
  decode(bytes: Uint8Array, mimeType?: string): Promise<{ samples: Float32Array; sampleRate: number; channels: number }>;
  saveSonicDna(jobId: string, claimToken: string, dna: SonicDnaFeatures): Promise<void>;
  generateAssessment(input: {
    evidence: Record<string, unknown>;
    sonicDna: Record<string, unknown> | null;
    catalogMetadata?: Record<string, unknown> | null;
  }): Promise<ArAssessment>;
  saveAssessment(jobId: string, claimToken: string, assessment: ArAssessment): Promise<void>;
  generateReport(input: AuditReportInput, tier: AuditReportTier): Promise<Uint8Array>;
  saveReport(jobId: string, claimToken: string, tier: AuditReportTier, pdf: Uint8Array, reportInput?: AuditReportInput): Promise<void>;
  markCompleted(jobId: string, claimToken: string): Promise<void>;
  markFailed(jobId: string, claimToken: string, message: string): Promise<void>;
  stopHeartbeat?(): Promise<void>;
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
  const pdf = await deps.generateReport(reportInput, tier);
  if (!isPdf(pdf)) throw new Error(`${tier} report generator did not return a PDF`);
  await deps.saveReport(jobId, claimToken, tier, pdf, tier === "full" ? reportInput : undefined);
}

export async function processAuditJob(
  jobId: string,
  deps: AuditProcessorDependencies,
): Promise<{ status: "completed" | "failed" }> {
  const job = await deps.getJob(jobId);
  if (!job) throw new Error("Audit job not found");
  if (job.status !== "processing") throw new Error(`Audit job is not actively claimed: ${job.status}`);

  try {
    await deps.markProcessing(jobId, job.claimToken);

    if (job.sourceType === "dsp_link") {
      if (!job.catalogUrl) throw new Error("Catalog URL is missing");
      const metadata = await deps.collectCatalogMetadata(job.catalogUrl);
      await deps.saveCatalogMetadata(jobId, job.claimToken, metadata);

      let recognition: AuditRecognition | null = null;
      if (metadata.previewUrl) {
        try {
          recognition = await deps.recognizeUrl(metadata.previewUrl);
        } catch {
          // Preview recognition is enrichment; catalog metadata remains authoritative evidence.
        }
        if (recognition) await deps.saveRecognition(jobId, job.claimToken, recognition);
      }

      const effectiveRecognition: AuditRecognition = recognition ?? { matched: false };
      const metadataInput = {
        ...catalogMetadataInput(metadata),
        audd: recognitionMetadataInput(effectiveRecognition),
      };
      const reconciliation = reconcileMetadata(metadataInput);
      await deps.saveEvidence(jobId, job.claimToken, effectiveRecognition, reconciliation, metadata);
      const identity = reconciliation.identity;
      const evidence = {
        ...catalogEvidence(metadata, identity),
        ...recognitionEvidence(effectiveRecognition),
        ...identityEvidence(identity),
        evidenceClass: reconciliation.status === "reconciled"
          ? "RECONCILED"
          : identity.sourceProviders.length > 0 ? "RECOGNIZED" : null,
        identity: identityEvidence(identity),
        reconciliation: reconciliationEvidence(reconciliation),
      };
      const sonicDna = catalogSonicDna(metadata);
      const assessment = await deps.generateAssessment({
        evidence,
        sonicDna,
        catalogMetadata: catalogEvidence(metadata, identity),
      });
      await deps.saveAssessment(jobId, job.claimToken, assessment);

      const generatedAt = new Date().toISOString();
      const reportInput = { auditId: jobId, generatedAt, evidence, sonicDna, assessment };
      await generateAndSaveReport(jobId, job.claimToken, reportInput, "sample", deps);
      await generateAndSaveReport(jobId, job.claimToken, reportInput, "full", deps);

      await deps.stopHeartbeat?.();
      await deps.markCompleted(jobId, job.claimToken);
      return { status: "completed" };
    }

    if (!job.sourceAudioPath || !job.mimeType) throw new Error("Master source is missing");
    const master = await deps.downloadMaster(job.sourceAudioPath);
    const sample = await deps.createRecognitionSample(master, job.mimeType);
    const recognition = await deps.recognize(sample);
    await deps.saveRecognition(jobId, job.claimToken, recognition);
    const reconciliation = reconcileMetadata({
      audd: recognitionMetadataInput(recognition),
    });
    await deps.saveEvidence(jobId, job.claimToken, recognition, reconciliation);
    const decoded = await deps.decode(master, job.mimeType);
    const dna = analyzePcm(decoded.samples, decoded.sampleRate, decoded.channels);
    const normalizedDna = {
      ...dna,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      durationSeconds: Math.floor(decoded.samples.length / Math.max(1, decoded.channels)) / decoded.sampleRate,
    };
    await deps.saveSonicDna(jobId, job.claimToken, normalizedDna);

    const identity = reconciliation.identity;
    const evidence = {
      auditType: "MASTER-BASED AUDIT",
      ...recognitionEvidence(recognition),
      ...identityEvidence(identity),
      identity: identityEvidence(identity),
      reconciliation: reconciliationEvidence(reconciliation),
    };
    const sonicDna = dnaEvidence(normalizedDna);
    const assessment = await deps.generateAssessment({
      evidence,
      sonicDna,
      catalogMetadata: null,
    });
    await deps.saveAssessment(jobId, job.claimToken, assessment);
    const generatedAt = new Date().toISOString();
    const reportInput = { auditId: jobId, generatedAt, evidence, sonicDna, assessment };
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "sample", deps);
    await generateAndSaveReport(jobId, job.claimToken, reportInput, "full", deps);

    await deps.stopHeartbeat?.();
    await deps.markCompleted(jobId, job.claimToken);
    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await deps.stopHeartbeat?.();
    await deps.markFailed(jobId, job.claimToken, message);
    return { status: "failed" };
  }
}
