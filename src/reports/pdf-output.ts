import { type AuditReportInput, type AuditReportTier } from "./generate-audit-report.js";
import { generateAuditReportV2 } from "./v2/render.js";

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReportInput(source: Uint8Array | string | unknown): AuditReportInput {
  let value: unknown = source;
  if (source instanceof Uint8Array) {
    try { value = JSON.parse(new TextDecoder().decode(source)); }
    catch { throw new Error("Report source is neither a PDF nor valid JSON."); }
  } else if (typeof source === "string") {
    try { value = JSON.parse(source); }
    catch { throw new Error("Report source is neither a PDF nor valid JSON."); }
  }
  if (!isRecord(value)
    || typeof value.auditId !== "string"
    || typeof value.generatedAt !== "string"
    || !isRecord(value.evidence)
    || (value.sonicDna !== null && !isRecord(value.sonicDna))
    || !isRecord(value.assessment)) {
    throw new Error("Report JSON payload does not contain a valid audit report input.");
  }
  return value as unknown as AuditReportInput;
}

export async function ensurePdfReport(source: Uint8Array | string | unknown, tier: AuditReportTier, signal?: AbortSignal): Promise<Uint8Array> {
  if (source instanceof Uint8Array && isPdf(source)) return source;
  const input = parseReportInput(source);
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("PDF_RENDER_ABORTED");
  const pdf = await generateAuditReportV2(input, tier, signal);
  if (!isPdf(pdf)) throw new Error("Report v2 renderer did not return a PDF.");
  return pdf;
}
