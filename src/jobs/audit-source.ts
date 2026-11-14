export type AuditSourceType = "master" | "dsp_link" | "combined";

export interface AuditSourceSelection {
  hasMaster: boolean;
  catalogUrl: string | null | undefined;
}

/** Validates and classifies the supplied sources without making either source depend on the other. */
export function classifyAuditSources(input: AuditSourceSelection): AuditSourceType {
  const catalogUrl = input.catalogUrl?.trim() || null;
  if (!input.hasMaster && !catalogUrl) {
    throw new Error("At least one audit source is required");
  }
  if (catalogUrl) {
    const url = new URL(catalogUrl);
    if (url.protocol !== "https:") throw new Error("DSP URL must use HTTPS");
    if (url.username || url.password) throw new Error("DSP URL must not contain credentials");
  }
  if (input.hasMaster && catalogUrl) return "combined";
  return input.hasMaster ? "master" : "dsp_link";
}
