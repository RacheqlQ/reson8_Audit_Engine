import { generateAuditReport, type AuditReportInput, type AuditReportTier } from "./generate-audit-report.js";

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
    try {
      value = JSON.parse(new TextDecoder().decode(source));
    } catch {
      throw new Error("Report source is neither a PDF nor valid JSON.");
    }
  } else if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error("Report source is neither a PDF nor valid JSON.");
    }
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

export async function ensurePdfReport(source: Uint8Array | string | unknown, tier: AuditReportTier): Promise<Uint8Array> {
  if (source instanceof Uint8Array && isPdf(source)) return source;
  const pdf = await generateAuditReport(parseReportInput(source), tier);
  if (!isPdf(pdf)) throw new Error("Audit report generator did not return a PDF.");
  return pdf;
}
