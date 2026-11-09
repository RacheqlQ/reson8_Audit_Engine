import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { generateAuditReport, planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";

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
    executiveSummary: "The supplied recording presents a coherent rhythmic identity and an introspective creative direction. The available evidence supports a preliminary A&R discussion, but it does not establish listener demand, market performance or a release outcome. The assessment separates reported measurements from interpretation and identifies the evidence still required before commercial decisions.",
    creativeIdentity: "The supplied sonic and identity context suggests an introspective R&B direction with a restrained rhythmic focus. This is a creative interpretation for discovery and positioning, not a measured genre classification or proof of audience preference. Listening review of the complete master remains necessary before finalizing the artist proposition.",
    strengths: ["The rhythmic profile gives the arrangement a clear point of reference for focused listening and comparison.", "The vocal identity can support a distinctive artist narrative when confirmed against the complete approved master.", "The reconciled track identity provides a practical foundation for accurate release documentation and future pitching."],
    risks: ["No verified audience telemetry is available to establish listener demand, retention or conversion behaviour.", "The supplied evidence does not confirm rights, final release metadata or campaign readiness across the intended platforms."],
    aAndRPositioning: {
      primaryLane: "Afro-R&B",
      adjacentLanes: ["Alternative R&B"],
      rationale: "The proposed Afro-R&B lane is a working discovery hypothesis based on the supplied identity and sonic context. It should be checked against the complete recording, the artist's wider catalogue and the intended release positioning before being used in external pitches or campaign materials.",
    },
    commercialRead: {
      marketability: "undetermined",
      rationale: "No verified streaming, listener, sales, revenue or playlist-conversion evidence was supplied. Marketability therefore remains undetermined, and any commercial conclusion would require platform-native analytics with a clear source, reporting period and measurement definition.",
    },
    releaseStrategy: {
      recommendation: "Build the release narrative around the strongest verified creative and identity signals, then validate the positioning with listening review and measurable audience response. Do not increase campaign spend or make commercial claims until the relevant platform evidence and release details have been independently confirmed.",
      priorities: ["Confirm the final artist, title, release date and rights metadata against authoritative distributor records.", "Review the complete approved master before finalizing the creative lane and production commentary.", "Collect platform-native audience and campaign measurements before evaluating commercial traction."],
    },
    evidenceGaps: ["No verified audience telemetry, retention history or campaign conversion data was included in the supplied evidence."],
    confidence: 0.82,
    limitations: ["This assessment is limited to the supplied identity and sonic evidence and cannot establish listener demand or commercial performance."],
    scorecard: {
      sonicIdentity: { score: 70, rationale: "The supplied audio measurements provide a useful but incomplete sonic profile. This score reflects descriptive coverage and does not claim audience demand or artistic quality." },
      metadataIntegrity: { score: 65, rationale: "Some identity fields are present, but the payload does not independently corroborate every release and rights field. This score reflects supplied metadata completeness only." },
      commercialEvidence: { score: null, rationale: "No verified audience, streaming, sales, revenue, or playlist-conversion evidence was supplied. A numeric score would imply unsupported certainty, so this dimension remains unscored until verified performance evidence is available." },
      releaseReadiness: { score: 55, rationale: "Identity and sonic context support preliminary planning, but audience validation and metadata checks remain outstanding. This score reflects evidence readiness rather than predicted performance or commercial outcomes." },
      hook: { score: null, rationale: "No supported hook-specific listening annotation or structural evidence was supplied for this fixture. The dimension remains unscored until complete master review identifies a repeatable hook." },
      originality: { score: null, rationale: "No comparative catalogue review or verified reference set is included, so originality cannot be judged without unsupported comparisons. This dimension remains unscored pending documented listening review." },
      production: { score: null, rationale: "The available measurements do not isolate mix, arrangement, vocal capture, mastering, or production decisions sufficiently to support a production-quality score. A detailed master review is required." },
      replayValue: { score: null, rationale: "No repeat-listening, completion, save, or retention telemetry is supplied. Replay value cannot be inferred from tempo or genre metadata, so this dimension remains unscored pending listener evidence." },
      laneClarity: { score: null, rationale: "The current metadata provides a provisional lane hypothesis, but no validated comparative listening review confirms how clearly the recording occupies that lane. Leave this dimension unscored until reviewed." },
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
    expect(document.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(document.getPageCount()).toBeLessThanOrEqual(4);
    const names = document.getForm().getFields().map((field) => field.getName());
    expect(names).toContain("executive_summary");
    expect(names).toContain("ar_positioning");
    expect(document.getForm().getTextField("executive_summary").getText()).toContain("SAMPLE / PREVIEW");
    expect(document.getForm().getTextField("executive_summary").getText()).toContain("METADATA-BASED AUDIT");
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

  it("renders null Sonic DNA as Not determined and preserves chart captions and headings", async () => {
    const nullInput: AuditReportInput = {
      ...input,
      evidence: { ...input.evidence, auditType: "MASTER-BASED AUDIT" },
      sonicDna: {
        provenance: "uploaded_audio_master",
        bpm: null,
        alternateTempo: null,
        key: null,
        mode: null,
        keyConfidence: null,
        energy: null,
        durationSeconds: null,
        loudnessLufs: null,
        dynamicRangeDb: null,
        moodTags: null,
      },
    };
    const bytes = await generateAuditReport(nullInput, "full");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(12);
    expect(document.getPageCount()).toBeLessThanOrEqual(20);

    const plannedText = planAuditReportPages(nullInput, "full").flatMap((page) => page.text).join("\n");
    expect(plannedText).toContain("Not determined");
    expect(plannedText).toContain("SHOWS:");
    expect(plannedText).toContain("CAN'T SHOW:");
    expect(plannedText).toContain("04 | Sonic DNA and audio profile");
    expect(plannedText).toContain("09 | Evidence-based scorecard");
  });

});
