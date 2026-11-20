import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { generateAuditReportV2 } from "../src/reports/v2/render.js";
import { generateAuditReport } from "../src/reports/generate-audit-report.js";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("v2 gated report pages", () => {
  it("omits market, Sonic DNA and moments pages for the Phillo/Stunixx low-confidence reference fixture", async () => {
    const input = structuredClone(ambiguousAudioFixture) as any;
    input.evidence = { ...input.evidence, artist: "Stunixx", title: "Phillo", album: null, isrc: null, upc: null, label: null,
      reconciliation: { conflicts: [{ field: "album", values: ["Hole-Hearted - EP", "Hole-Hearted"] }] } };
    const pdf = await PDFDocument.load(await generateAuditReportV2(input));
    expect(pdf.getPageCount()).toBe(9);
  });

  it("renders all three gated pages when every required test-only input is supplied", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, tempoConfidence: .9, keyConfidence: .9, keySegmentAgreement: .9, energyConfidence: .9,
      structure: [{ label: "Intro", startSeconds: 0, endSeconds: 12 }],
      energyOverTime: [{ timeSeconds: 0, value: 20 }, { timeSeconds: 12, value: 70 }],
      sonicDnaAxes: Object.fromEntries(["Rhythm", "Harmony", "Texture", "Vocal", "Space"].map(name => [name, { score: 70 }])),
      flaggedMoments: [{ timestampSeconds: 12, title: "Hook entry", note: "Synthetic test observation", tag: "Strength" }] };
    input.evidence.verifiedComparables = [{ title: "Fixture Comparable", year: 2024, lane: "Fixture lane", similarity: 75, basis: "Test basis", source: "fixture source" }];
    expect((await PDFDocument.load(await generateAuditReportV2(input))).getPageCount()).toBe(12);
  });

  it("keeps the full report at the existing v1 page count while applying the v2 design", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    const baseline = await generateAuditReport(input, "full");
    const redesigned = await generateAuditReportV2(input);
    expect((await PDFDocument.load(redesigned)).getPageCount())
      .toBe((await PDFDocument.load(baseline)).getPageCount());
  });

  it("does not add pages to the full report when optional analytical evidence is present", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      structure: [{ label: "Intro", startSeconds: 0, endSeconds: 12 }],
      energyOverTime: [{ timeSeconds: 0, value: 20 }, { timeSeconds: 12, value: 70 }],
      sonicDnaAxes: Object.fromEntries(["Rhythm", "Harmony", "Texture", "Vocal", "Space"].map(name => [name, { score: 70 }])),
      flaggedMoments: [{ timestampSeconds: 12, title: "Hook entry", note: "Synthetic test observation", tag: "Strength" }]
    };
    input.evidence.verifiedComparables = [{ title: "Fixture Comparable", year: 2024, lane: "Fixture lane", similarity: 75, basis: "Test basis", source: "fixture source" }];
    const baseline = await generateAuditReport(input, "full");
    const redesigned = await generateAuditReportV2(input);
    expect((await PDFDocument.load(redesigned)).getPageCount())
      .toBe((await PDFDocument.load(baseline)).getPageCount());
  });

  it("omits every gated page for a minimal audio-only fixture", async () => {
    const input = { ...metadataOnlyFixture, evidence: { fixture: true, auditType: "AUDIO-ONLY", artist: null, title: null }, sonicDna: { provenance: "fixture", bpm: null, key: null, mode: null, tempoConfidence: 0, keyConfidence: 0 } };
    expect((await PDFDocument.load(await generateAuditReportV2(input as any))).getPageCount()).toBe(9);
  });
});
