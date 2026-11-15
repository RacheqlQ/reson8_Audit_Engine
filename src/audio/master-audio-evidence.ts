export interface AuditSourceReadinessInput {
  sourceType: "master" | "dsp_link" | "combined";
  sourceAudioPath: string | null;
  mimeType: string | null;
  catalogUrl: string | null;
  catalogUrls?: string[];
}

export function getAuditSourceReadinessError(job: AuditSourceReadinessInput): string | null {
  const hasCatalog = Boolean(job.catalogUrls?.some((url) => typeof url === "string" && url.trim()) || job.catalogUrl?.trim());
  const needsMaster = job.sourceType === "master" || job.sourceType === "combined";
  const needsCatalog = job.sourceType === "dsp_link" || job.sourceType === "combined";

  if (needsMaster && !job.sourceAudioPath?.trim()) {
    return job.sourceType === "combined"
      ? "Combined audit is missing its uploaded master audio path; refusing to downgrade to DSP-only."
      : "Master audit is missing its uploaded master audio path.";
  }
  if (needsMaster && !job.mimeType?.trim()) {
    return "Master audio submission is incomplete: MIME type is missing.";
  }
  if (needsCatalog && !hasCatalog) {
    return job.sourceType === "combined"
      ? "Combined audit is missing its DSP catalog link; refusing to downgrade to master-only."
      : "DSP audit is missing its catalog link.";
  }
  return null;
}

export function hasSubmittedMasterAudio(
  evidence: Record<string, unknown>,
  sonicDna: Record<string, unknown> | null,
): boolean {
  const marker = evidence.masterAudio;
  const explicitSubmission = Boolean(
    marker
    && typeof marker === "object"
    && !Array.isArray(marker)
    && (marker as Record<string, unknown>).provenance === "uploaded_audio_master"
    && (marker as Record<string, unknown>).evidenceClass === "OBSERVED",
  );
  return explicitSubmission || sonicDna?.provenance === "uploaded_audio_master";
}
