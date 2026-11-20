import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildPositioningLines, buildNextActionLine, buildReleaseFramingLine, buildIdentityReconciliationRows, generateAuditReportV2 } from "../src/reports/v2/render.js";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("v2 decision and date framing", () => {
  it("uses only the supplied release-strategy recommendation or first evidence gap", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.releaseStrategy.recommendation = "";
    input.assessment.evidenceGaps = ["Confirm recording identifiers"];
    expect(buildNextActionLine(input)).toBe("Recommended next step: Confirm recording identifiers");
    input.assessment.evidenceGaps = [];
    expect(buildNextActionLine(input)).toBe("Recommended next step: Not supplied");
  });

  it("compares release date to generatedAt rather than the current clock", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.generatedAt = "2025-01-01T00:00:00.000Z";
    input.evidence.releaseDate = "2025-06-01";
    expect(buildReleaseFramingLine(input)).toContain("date does not establish a past release");
    input.generatedAt = "2025-12-01T00:00:00.000Z";
    expect(buildReleaseFramingLine(input)).toContain("release date is in the past");
  });
});

describe("v2 identity reconciliation table data", () => {
  it("keeps conflicts visible and uses only supplied field provenance", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.fixture = false;
    input.evidence.sources = [];
    input.evidence.fieldProvenance = { artist: "apple_music" };
    input.evidence.reconciliation = {
      conflicts: [{ field: "album", values: ["Fixture EP", "Alternate EP"] }],
      reconciledFields: ["title"]
    };
    const rows = buildIdentityReconciliationRows(input);
    expect(rows.find((row: any) => row.field === "Artist"))
      .toMatchObject({ value: "Fixture Artist", status: "Source-returned", source: "Apple Music" });
    expect(rows.find((row: any) => row.field === "Track"))
      .toMatchObject({ value: "Fixture Track", status: "Cross-checked", source: "unavailable" });
    expect(rows.find((row: any) => row.field === "Album"))
      .toMatchObject({ value: "Fixture EP vs Alternate EP", status: "Conflict" });
    expect(rows.find((row: any) => row.field === "UPC"))
      .toMatchObject({ value: "Unavailable", status: "Unavailable" });
  });
});

describe("v2 gated report pages", () => {
  it("provides a useful positioning decision panel when no lane evidence exists", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.laneHypotheses = [];
    input.assessment.adjacentLanes = [];
    input.evidence.genre = null;
    const lines = buildPositioningLines(input);
    expect(lines.join(" ")).toContain("Positioning not established");
    expect(lines.join(" ")).toContain("provider-attributed genre");
    expect(lines.every((line: string) => line.trim().length > 0)).toBe(true);
  });

  it("omits market, Sonic DNA and moments pages for the Phillo/Stunixx low-confidence reference fixture", async () => {
    const input = structuredClone(ambiguousAudioFixture) as any;
    input.evidence = { ...input.evidence, artist: "Stunixx", title: "Phillo", album: null, isrc: null, upc: null, label: null,
      reconciliation: { conflicts: [{ field: "album", values: ["Hole-Hearted - EP", "Hole-Hearted"] }] } };
    const pdf = await PDFDocument.load(await generateAuditReportV2(input));
    expect(pdf.getPageCount()).toBe(9);
  });

  it("keeps a complete evidence-rich sample at nine pages without dropping gated evidence", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, tempoConfidence: .9, keyConfidence: .9, keySegmentAgreement: .9, energyConfidence: .9,
      structure: [{ label: "Intro", startSeconds: 0, endSeconds: 12 }],
      energyOverTime: [{ timeSeconds: 0, value: 20 }, { timeSeconds: 12, value: 70 }],
      sonicDnaAxes: Object.fromEntries(["Rhythm", "Harmony", "Texture", "Vocal", "Space"].map(name => [name, { score: 70 }])),
      flaggedMoments: [{ timestampSeconds: 12, title: "Hook entry", note: "Synthetic test observation", tag: "Strength" }] };
    input.evidence.verifiedComparables = [{ title: "Fixture Comparable", year: 2024, lane: "Fixture lane", similarity: 75, basis: "Test basis", source: "fixture source" }];
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    expect(pdf.getPageCount()).toBe(9);
    expect(pdf.getForm().getFields().map(field => field.getName())).toContain("ar_notes");
  });

  it("keeps a full report within the approved 12–13 page range without consulting v1 pagination", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(12);
    expect(pdf.getPageCount()).toBeLessThanOrEqual(13);
  });

  it("keeps an expanded real-world narrative inside the fixed 12-page full-report allocation", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.executiveSummary = Array(3).fill(input.assessment.executiveSummary).join(" ");
    input.assessment.strengths = [...input.assessment.strengths, ...Array(5).fill(
      "The arrangement offers a clear opportunity for a human A&R reviewer to test the hook, vocal performance, production balance and listener context against the submitted master."
    )];
    input.assessment.risks = [...input.assessment.risks, ...Array(5).fill(
      "A release decision still requires rights clearance, delivery confirmation, approved final master and source-attributed commercial reporting."
    )];
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBe(12);
  });

  it("keeps optional analytical evidence within 13 full-report pages", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      structure: [{ label: "Intro", startSeconds: 0, endSeconds: 12 }],
      energyOverTime: [{ timeSeconds: 0, value: 20 }, { timeSeconds: 12, value: 70 }],
      sonicDnaAxes: Object.fromEntries(["Rhythm", "Harmony", "Texture", "Vocal", "Space"].map(name => [name, { score: 70 }])),
      flaggedMoments: [{ timestampSeconds: 12, title: "Hook entry", note: "Synthetic test observation", tag: "Strength" }]
    };
    input.evidence.verifiedComparables = [{ title: "Fixture Comparable", year: 2024, lane: "Fixture lane", similarity: 75, basis: "Test basis", source: "fixture source" }];
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(12);
    expect(pdf.getPageCount()).toBeLessThanOrEqual(13);
  });

  it("omits every gated page for a minimal audio-only fixture", async () => {
    const input = { ...metadataOnlyFixture, evidence: { fixture: true, auditType: "AUDIO-ONLY", artist: null, title: null }, sonicDna: { provenance: "fixture", bpm: null, key: null, mode: null, tempoConfidence: 0, keyConfidence: 0 } };
    expect((await PDFDocument.load(await generateAuditReportV2(input as any))).getPageCount()).toBe(9);
  });
});
