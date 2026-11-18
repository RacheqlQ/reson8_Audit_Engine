import { randomBytes } from "node:crypto";
import { sha256 } from "./content-hash.js";
import { validateAudioUpload } from "./audio-intake.js";
import { classifyAuditSources } from "./audit-source.js";
import { normalizeDspTrackLinks } from "../providers/dsp/intake.js";

export interface CreateAuditJobInput {
  ownerId: string | null;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  catalogUrl?: string | null;
  catalogUrls?: readonly string[];
}

export interface CreateAuditJobDependencies {
  ensureProfile?: (ownerId: string) => Promise<void>;
  createJob: (input: { ownerId: string | null; filename: string; mimeType: string; sizeBytes: number; sha256: string; sourceType: "master" | "combined"; catalogUrl: string | null; catalogUrls?: string[]; reportAccessTokenHash: string; }) => Promise<string>;
  createCatalogJob: (input: { ownerId: string | null; catalogUrl: string; catalogUrls?: string[]; sha256: string; reportAccessTokenHash: string }) => Promise<string>;
  uploadMaster: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  setSourcePath: (jobId: string, path: string) => Promise<void>;
  deleteMaster: (path: string) => Promise<void>;
  deleteJob?: (jobId: string) => Promise<void>;
}

export async function createAuditJob(
  input: CreateAuditJobInput,
  deps: CreateAuditJobDependencies,
) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  let phaseStartedAt = performance.now();
  const validated = validateAudioUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  timings.validationMs = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const digest = await sha256(input.bytes);
  timings.audioHashMs = performance.now() - phaseStartedAt;
  const submittedLinks = input.catalogUrls?.length
    ? normalizeDspTrackLinks(input.catalogUrls).map((link) => link.canonicalUrl)
    : input.catalogUrl?.trim()
      ? normalizeDspTrackLinks([input.catalogUrl]).map((link) => link.canonicalUrl)
      : [];
  const catalogUrl = submittedLinks[0] ?? null;
  const classifiedSource = classifyAuditSources({ hasMaster: true, catalogUrl });
  if (classifiedSource === "dsp_link") throw new Error("A master upload must include a master source");
  const sourceType: "master" | "combined" = classifiedSource;
  const reportAccessToken = randomBytes(32).toString("hex");
  phaseStartedAt = performance.now();
  const reportAccessTokenHash = await sha256(new TextEncoder().encode(reportAccessToken));
  timings.accessTokenHashMs = performance.now() - phaseStartedAt;

  phaseStartedAt = performance.now();
  const jobId = await deps.createJob({
    ownerId: input.ownerId,
    filename: validated.filename,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    sha256: digest,
    sourceType,
    catalogUrl,
    ...(submittedLinks.length ? { catalogUrls: submittedLinks } : {}),
    reportAccessTokenHash,
  });
  timings.createJobMs = performance.now() - phaseStartedAt;

  const sourceAudioPath = `${input.ownerId ?? "anonymous"}/${jobId}/${validated.filename}`;

  try {
    phaseStartedAt = performance.now();
    await deps.uploadMaster(sourceAudioPath, input.bytes, validated.mimeType);
    timings.storageUploadMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    await deps.setSourcePath(jobId, sourceAudioPath);
    timings.sourcePathFinalizeMs = performance.now() - phaseStartedAt;
  } catch (error) {
    try {
      await deps.deleteMaster(sourceAudioPath);
    } catch {
      // Preserve the original pipeline error; cleanup failure is operational telemetry.
    }
    try {
      await deps.deleteJob?.(jobId);
    } catch {
      // Preserve the original pipeline error; cleanup failure is operational telemetry.
    }
    throw error;
  }

  if (process.env.NODE_ENV !== "test") {
    console.info(JSON.stringify({
      event: "audit_job_creation_timing",
      jobId,
      sourceType,
      audioBytes: input.bytes.byteLength,
      ...timings,
      totalMs: performance.now() - startedAt,
    }));
  }
  return { jobId, sourceAudioPath, sha256: digest, sourceType, reportAccessToken };
}
