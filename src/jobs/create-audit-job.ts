import { randomBytes } from "node:crypto";
import { sha256 } from "./content-hash.js";
import { validateAudioUpload } from "./audio-intake.js";
import { classifyAuditSources } from "./audit-source.js";

export interface CreateAuditJobInput {
  ownerId: string | null;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  catalogUrl?: string | null;
}

export interface CreateAuditJobDependencies {
  ensureProfile?: (ownerId: string) => Promise<void>;
  createJob: (input: { ownerId: string | null; filename: string; mimeType: string; sizeBytes: number; sha256: string; sourceType: "master" | "combined"; catalogUrl: string | null; reportAccessTokenHash: string; }) => Promise<string>;
  createCatalogJob: (input: { ownerId: string | null; catalogUrl: string; sha256: string; reportAccessTokenHash: string }) => Promise<string>;
  uploadMaster: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  setSourcePath: (jobId: string, path: string) => Promise<void>;
  deleteMaster: (path: string) => Promise<void>;
  deleteJob?: (jobId: string) => Promise<void>;
}

export async function createAuditJob(
  input: CreateAuditJobInput,
  deps: CreateAuditJobDependencies,
) {
  const validated = validateAudioUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  const digest = await sha256(input.bytes);
  const classifiedSource = classifyAuditSources({ hasMaster: true, catalogUrl: input.catalogUrl });
  if (classifiedSource === "dsp_link") throw new Error("A master upload must include a master source");
  const sourceType: "master" | "combined" = classifiedSource;
  const reportAccessToken = randomBytes(32).toString("hex");
  const reportAccessTokenHash = await sha256(new TextEncoder().encode(reportAccessToken));

  const jobId = await deps.createJob({
    ownerId: input.ownerId,
    filename: validated.filename,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    sha256: digest,
    sourceType,
    catalogUrl: input.catalogUrl?.trim() || null,
    reportAccessTokenHash,
  });

  const sourceAudioPath = `${input.ownerId ?? "anonymous"}/${jobId}/${validated.filename}`;

  try {
    await deps.uploadMaster(sourceAudioPath, input.bytes, validated.mimeType);
    await deps.setSourcePath(jobId, sourceAudioPath);
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

  return { jobId, sourceAudioPath, sha256: digest, sourceType, reportAccessToken };
}
