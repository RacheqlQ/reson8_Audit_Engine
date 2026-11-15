import type { AuditRecognition } from "../providers/audd/normalize.js";
import type { CatalogMetadata } from "../providers/dsp/catalog.js";
import type { ArAssessment } from "../providers/groq/client.js";
import type { AuditReportInput, AuditReportTier } from "../reports/generate-audit-report.js";
import { isPdf } from "../reports/pdf-output.js";
import { analyzePcm, type SonicDnaFeatures } from "../audio/sonic-dna.js";
import type { TrackIdentity } from "../metadata/MetadataEngine.js";
import { reconcileMetadata, type MetadataReconciliation } from "../metadata/ReconciliationEngine.js";
import { readAudioTags } from "../metadata/audio-tags.js";
import { normalizeDspTrackLinks } from "../providers/dsp/intake.js";
import { collectDspMetadata, type DspMetadataResult } from "../providers/dsp/registry.js";

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
    if (source.platform === "tidal") result.tidal = fields;
    if (source.platform === "apple_music") result.apple_music = fields;
    if (source.platform === "deezer") result.deezer = fields;
    if (source.platform === "youtube_music") result.youtube_music = fields;
    if (source.platform === "audiomack") result.audiomack = fields;
  }
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
    limitations: dna.limitations,
    loudnessLufs: dna.loudnessLufs,
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
    const hasCatalog = Boolean(job.catalogUrls?.length || job.catalogUrl);
    if (!hasMaster && !hasCatalog) throw new Error("Audit job has no usable source");

    let metadata: CatalogMetadata | undefined;
    let metadataSources: CatalogMetadata[] = [];
    let catalogResults: DspMetadataResult[] = [];
    if (hasCatalog) {
      const links = normalizeDspTrackLinks(job.catalogUrls?.length ? job.catalogUrls : [job.catalogUrl!]);
      catalogResults = await awaitWithLease(deps, (signal) =>
        collectDspMetadata(links, { collect: deps.collectCatalogMetadata }, signal),
      );
      metadataSources = catalogResults.flatMap((result) => result.metadata ? [result.metadata] : []);
      // Persist failures first so the final successful catalog write, when present,
      // remains the job row's latest raw metadata snapshot.
      for (const result of catalogResults) {
        if (!result.metadata && result.error && deps.saveCatalogFailure) {
          await awaitWithLease(deps, (signal) =>
            deps.saveCatalogFailure!(jobId, job.claimToken, result.link, result.error!, signal),
          );
        }
      }
      for (const result of catalogResults) {
        if (result.metadata) {
          await awaitWithLease(deps, (signal) =>
            deps.saveCatalogMetadata(jobId, job.claimToken, result.metadata!, signal),
          );
        }
      }
      if (!metadataSources.length) {
        const failures = catalogResults.map((result) => result.error).filter(Boolean).join("; ");
        throw new Error(failures || "No DSP provider returned usable track metadata");
      }
      metadata = metadataSources[0];
    }

    let masterDna: SonicDnaFeatures | null = null;
    let masterRecognition: AuditRecognition | null = null;
    let masterTags: ReturnType<typeof readAudioTags> | null = null;
    const attemptedRecognitionProviders = new Set<string>();
    if (hasMaster) {
      const master = await awaitWithLease(deps, (signal) => deps.downloadMaster(job.sourceAudioPath!, signal));
      masterTags = readAudioTags(master);
      const sample = await awaitWithLease(deps, (signal) => deps.createRecognitionSample(master, job.mimeType!, signal));
      masterRecognition = await awaitWithLease(deps, (signal) => {
        attemptedRecognitionProviders.add("audd");
        return deps.recognize(sample, signal);
      });
      const decoded = await awaitWithLease(deps, (signal) => deps.decode(master, job.mimeType!, signal));
      const dna = analyzePcm(decoded.samples, decoded.sampleRate, decoded.channels);
      masterDna = {
        ...dna,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        durationSeconds: Math.floor(decoded.samples.length / Math.max(1, decoded.channels)) / decoded.sampleRate,
      };
    }

    let catalogRecognition: AuditRecognition | null = null;
    const previewMetadata = metadataSources.find((source) => source.previewUrl);
    if (previewMetadata?.previewUrl) {
      try {
        catalogRecognition = await awaitWithLease(deps, (signal) => {
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
      await awaitWithLease(deps, (signal) => deps.saveRecognition(jobId, job.claimToken, recognition, signal));
    }

    const metadataInput = {
      ...(metadataSources.length ? catalogMetadataInput(metadataSources) : {}),
      ...(masterTags ? { id3: masterTags } : {}),
      ...(job.filename ? { filename: job.filename } : {}),
      audd: recognitionMetadataInput(recognition),
    };
    const reconciliation = reconcileMetadata(metadataInput);
    await awaitWithLease(deps, (signal) => deps.saveEvidence(jobId, job.claimToken, recognition, reconciliation, metadata, signal, metadataSources));
    if (masterDna) {
      await awaitWithLease(deps, (signal) => deps.saveSonicDna(jobId, job.claimToken, masterDna!, signal));
    }

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
      metadataSourcesChecked: [...catalogResults.map((result) => result.link.platform), ...(masterTags ? ["id3"] : []), ...(job.filename ? ["filename"] : []), ...attemptedRecognitionProviders],
      catalogSources: catalogResults.map((result) => ({ platform: result.link.platform, catalogId: result.link.catalogId, canonicalUrl: result.link.canonicalUrl, status: result.status, error: result.error })),
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
      metadataSourcesChecked: [
        ...catalogResults.filter((result) => result.link.platform !== "spotify").map((result) => result.link.platform),
        ...(masterTags ? ["id3"] : []),
        ...(job.filename ? ["filename"] : []),
        ...attemptedRecognitionProviders,
      ],
      catalogSources: catalogResults
        .filter((result) => result.link.platform !== "spotify")
        .map((result) => ({ platform: result.link.platform, catalogId: result.link.catalogId, canonicalUrl: result.link.canonicalUrl, status: result.status, error: result.error })),
      sourceCombination: evidence.sourceCombination,
      ...(hasMaster ? { masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } } : {}),
    };
    const sonicDna = masterDna
      ? dnaEvidence(masterDna)
      : assessmentMetadata
        ? catalogSonicDna(assessmentMetadata)
        : null;
    const assessment = await awaitWithLease(deps, (signal) => deps.generateAssessment({
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
