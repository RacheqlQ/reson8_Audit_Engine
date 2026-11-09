import type { AuditRecognition } from "../providers/audd/normalize.js";
import type { CatalogMetadata } from "../providers/dsp/catalog.js";
import type { ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
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
}

export interface AuditProcessorDependencies {
  getJob(jobId: string): Promise<AuditJobRecord | null>;
  markProcessing(jobId: string): Promise<void>;
  collectCatalogMetadata(url: string): Promise<CatalogMetadata>;
  recognizeUrl(url: string): Promise<AuditRecognition>;
  downloadMaster(path: string): Promise<Uint8Array>;
  createRecognitionSample(master: Uint8Array, mimeType: string): Promise<Uint8Array>;
  recognize(sample: Uint8Array): Promise<AuditRecognition>;
  saveRecognition(jobId: string, recognition: AuditRecognition): Promise<void>;
  saveEvidence(jobId: string, recognition: AuditRecognition): Promise<void>;
  saveCatalogMetadata(jobId: string, metadata: CatalogMetadata): Promise<void>;
  decode(bytes: Uint8Array, mimeType?: string): Promise<{ samples: Float32Array; sampleRate: number; channels: number }>;
  saveSonicDna(jobId: string, dna: SonicDnaFeatures): Promise<void>;
  generateAssessment(input: {
    evidence: Record<string, unknown>;
    sonicDna: Record<string, unknown> | null;
    catalogMetadata?: Record<string, unknown> | null;
  }): Promise<ArAssessment>;
  saveAssessment(jobId: string, assessment: ArAssessment): Promise<void>;
  generateReport(input: AuditReportInput, tier: AuditReportTier): Promise<Uint8Array>;
  saveReport(jobId: string, tier: AuditReportTier, pdf: Uint8Array): Promise<void>;
  markCompleted(jobId: string): Promise<void>;
  markFailed(jobId: string, message: string): Promise<void>;
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
    confidence: 1,
    source: "audd",
  };
}

function catalogMetadataInput(metadata: CatalogMetadata) {
  const provider = metadata.platform === "spotify" || metadata.platform === "tidal"
    ? metadata.platform
    : null;

  return {
    spotify: provider === "spotify"
      ? {
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          isrc: metadata.isrc,
          label: metadata.label,
          releaseDate: metadata.releaseDate,
          genres: metadata.genre ? [metadata.genre] : [],
        }
      : null,
    tidal: provider === "tidal"
      ? {
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          isrc: metadata.isrc,
          label: metadata.label,
          releaseDate: metadata.releaseDate,
          genres: metadata.genre ? [metadata.genre] : [],
        }
      : null,
  };
}

function recognitionMetadataInput(recognition: AuditRecognition) {
  return {
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
    moodTags: dna.moodTags,
    genreContext: dna.genreContext,
  };
}

export async function processAuditJob(
  jobId: string,
  deps: AuditProcessorDependencies,
): Promise<{ status: "completed" | "failed" }> {
  const job = await deps.getJob(jobId);
  if (!job) throw new Error("Audit job not found");
  if (job.status !== "queued") throw new Error(`Audit job is not queued: ${job.status}`);

  try {
    await deps.markProcessing(jobId);

    if (job.sourceType === "dsp_link") {
      if (!job.catalogUrl) throw new Error("Catalog URL is missing");
      const metadata = await deps.collectCatalogMetadata(job.catalogUrl);
      await deps.saveCatalogMetadata(jobId, metadata);

      let recognition: AuditRecognition | null = null;
      if (metadata.previewUrl) {
        try {
          recognition = await deps.recognizeUrl(metadata.previewUrl);
          await deps.saveRecognition(jobId, recognition);
          await deps.saveEvidence(jobId, recognition);
        } catch {
          // Preview recognition is enrichment; catalog metadata remains authoritative evidence.
        }
      }

      const metadataInput = {
        ...catalogMetadataInput(metadata),
        audd: recognition ? recognitionMetadataInput(recognition) : null,
      };
      const reconciliation = reconcileMetadata(metadataInput);
      const identity = reconciliation.identity;
      const evidence = recognition
        ? {
            auditType: "METADATA-BASED AUDIT",
            ...recognitionEvidence(recognition),
            ...identityEvidence(identity),
            identity: identityEvidence(identity),
            reconciliation: reconciliationEvidence(reconciliation),
          }
        : catalogEvidence(metadata, identity);
      const sonicDna = catalogSonicDna(metadata);
      const assessment = await deps.generateAssessment({
        evidence,
        sonicDna,
        catalogMetadata: catalogEvidence(metadata, identity),
      });
      await deps.saveAssessment(jobId, assessment);

      const generatedAt = new Date().toISOString();
      const reportInput = { auditId: jobId, generatedAt, evidence, sonicDna, assessment };
      const samplePdf = await deps.generateReport(reportInput, "sample");
      await deps.saveReport(jobId, "sample", samplePdf);
      const pdf = await deps.generateReport(reportInput, "full");
      await deps.saveReport(jobId, "full", pdf);

      await deps.markCompleted(jobId);
      return { status: "completed" };
    }

    if (!job.sourceAudioPath || !job.mimeType) throw new Error("Master source is missing");
    const master = await deps.downloadMaster(job.sourceAudioPath);
    const sample = await deps.createRecognitionSample(master, job.mimeType);
    const recognition = await deps.recognize(sample);
    await deps.saveRecognition(jobId, recognition);
    await deps.saveEvidence(jobId, recognition);
    const decoded = await deps.decode(master, job.mimeType);
    const dna = analyzePcm(decoded.samples, decoded.sampleRate, decoded.channels);
    const normalizedDna = {
      ...dna,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      durationSeconds: Math.floor(decoded.samples.length / Math.max(1, decoded.channels)) / decoded.sampleRate,
    };
    await deps.saveSonicDna(jobId, normalizedDna);

    const reconciliation = reconcileMetadata({
      audd: recognitionMetadataInput(recognition),
      filename: job.sourceAudioPath,
    });
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
    await deps.saveAssessment(jobId, assessment);
    const generatedAt = new Date().toISOString();
    const reportInput = { auditId: jobId, generatedAt, evidence, sonicDna, assessment };
    const samplePdf = await deps.generateReport(reportInput, "sample");
    await deps.saveReport(jobId, "sample", samplePdf);
    const pdf = await deps.generateReport(reportInput, "full");
    await deps.saveReport(jobId, "full", pdf);

    await deps.markCompleted(jobId);
    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await deps.markFailed(jobId, message);
    return { status: "failed" };
  }
}
