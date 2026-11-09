import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { generateAuditReport, type AuditReportInput } from "../src/reports/generate-audit-report.js";

const input: AuditReportInput = {
  auditId: "job-123",
  generatedAt: "2026-10-04T03:00:00.000Z",
  evidence: {
    status: "verified",
    auditType: "METADATA-BASED AUDIT",
    artist: "Artist",
    title: "Song",
    isrc: "NGABC2600001",
    sources: ["audd", "spotify"],
  },
  sonicDna: {
    provenance: "tidal_catalog_metadata",
    bpm: 94,
    key: null,
    mode: null,
    loudnessLufs: -12.4,
    rmsEnergy: 0.08,
    dynamicRangeDb: 9.2,
    spectralCentroidHz: 1800,
    moodTags: ["Low Energy"],
    genreContext: ["R&B", "Afrobeats"],
  },
  assessment: {
    assessmentVersion: "1.0",
    executiveSummary: "Strong rhythmic identity.",
    creativeIdentity: "Introspective R&B.",
    strengths: ["Rhythm", "Vocal identity"],
    risks: ["Limited market evidence"],
    aAndRPositioning: {
      primaryLane: "Afro-R&B",
      adjacentLanes: ["Alternative R&B"],
      rationale: "Supported by observed evidence.",
    },
    commercialRead: {
      marketability: "undetermined",
      rationale: "No market evidence supplied.",
    },
    releaseStrategy: {
      recommendation: "Lead with the strongest sonic identity.",
      priorities: ["Validate audience response"],
    },
    evidenceGaps: ["Audience telemetry"],
    confidence: 0.82,
    limitations: ["Evidence-limited assessment"],
    scorecard: {
      sonicIdentity: { score: 70, rationale: "The supplied audio measurements provide a useful but incomplete sonic profile. This score reflects descriptive coverage and does not claim audience demand or artistic quality." },
      metadataIntegrity: { score: 65, rationale: "Some identity fields are present, but the payload does not independently corroborate every release and rights field. This score reflects supplied metadata completeness only." },
      commercialEvidence: { score: null, rationale: "No verified audience, streaming, sales, revenue, or playlist-conversion evidence was supplied. A numeric score would imply unsupported certainty, so this dimension remains unscored." },
      releaseReadiness: { score: 55, rationale: "Identity and sonic context support preliminary planning, but audience validation and metadata checks remain outstanding. This score reflects evidence readiness rather than predicted performance." },
    },
    evidenceLabels: [
      { label: "OBSERVED", claim: "The supplied audio analysis reports a tempo measurement for the recording.", source: "sonicDna.bpm" },
      { label: "INFERRED", claim: "The proposed creative lane is an interpretation and not a measured genre fact.", source: "sonicDna.genreContext" },
    ],
  },
};

describe("generateAuditReport", () => {
  it("creates a three-page sample PDF with no full-report-only fields", async () => {
    const pdf = await generateAuditReport(input, "sample");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(3);
    const names = document.getForm().getFields().map((field) => field.getName());
    expect(names).toContain("executive_summary");
    expect(names).toContain("ar_positioning");
    expect(names).not.toContain("risks");
    expect(names).not.toContain("release_strategy");
    expect(names).not.toContain("scorecard");
  });

  it("creates a content-structured full report of at least twelve pages", async () => {
    const pdf = await generateAuditReport(input, "full");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(12);
    expect(document.getPageCount()).toBeLessThanOrEqual(20);
  });
});
