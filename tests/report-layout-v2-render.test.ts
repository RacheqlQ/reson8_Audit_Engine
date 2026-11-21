import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildPositioningLines, buildNextActionLine, buildReleaseFramingLine, buildIdentityReconciliationRows, generateAuditReportV2 } from "../src/reports/v2/render.js";
import * as reportV2Render from "../src/reports/v2/render.js";
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
    expect(rows.find((row: any) => row.field === "Release code"))
      .toMatchObject({ value: "Unavailable", status: "Unavailable" });
  });
});

describe("v2 report limitation disclosure", () => {
  it("removes internal disabled/not-performed vocal status notices without adding a vocal-analysis claim", () => {
    const lines = reportV2Render.publicReportLimitations([
      "Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.",
      "Vocal presence/absence is unknown and is not inferred.",
      "No vocal conclusion is available because the separation model did not complete.",
      "Learned audio model: disabled.",
      "Rights clearance has not been verified.",
      "The supplied master has an unresolved identity conflict."
    ]);
    expect(lines).toEqual([
      "Rights clearance has not been verified.",
      "The supplied master has an unresolved identity conflict."
    ]);
  });

  it("keeps unrelated limitations while suppressing only internal vocal/model state", () => {
    const lines = reportV2Render.publicReportLimitations([
      "No valid timestamped energy series was supplied.",
      "Vocal analysis was not performed.",
      "No verified commercial metrics were supplied."
    ]);
    expect(lines).toEqual([
      "No valid timestamped energy series was supplied.",
      "No verified commercial metrics were supplied."
    ]);
  });
});

describe("v2 DSP playlist provider diagnostics", () => {
  it("surfaces Spotify HTTP failures and exact credential variable names", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.playlistDiscovery = {
      status: "unavailable",
      outcomes: [
        { provider: "spotify", status: "unavailable", reason: "Spotify catalog request failed with HTTP 403" },
        { provider: "apple_music", status: "not_configured", reason: "Apple Music developer token is not configured." }
      ]
    };
    const lines = reportV2Render.buildPlaylistProviderStatusLines(input).join(" ");
    expect(lines).toContain("Spotify playlist search unavailable:");
    expect(lines).toContain("HTTP 403");
    expect(lines).toContain("Apple Music playlist search unavailable:");
  });

  it("does not claim playlist discovery ran when no provider outcome was persisted", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.playlistDiscovery = null;
    const lines = reportV2Render.buildPlaylistProviderStatusLines(input);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Playlist discovery not run");
    expect(lines[0]).toContain("no playlist target is asserted");
  });

  it("does not label a successful no-match response as provider failure", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.playlistDiscovery = {
      outcomes: [{ provider: "spotify", status: "no_matches", reason: "No matching public playlist metadata was returned." }]
    };
    expect(reportV2Render.buildPlaylistProviderStatusLines(input)).toEqual([]);
  });
});

describe("v2 detector diagnostics", () => {
  it("renders plain-language provisional tempo readings and abstention", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, rhythmFeatures: {
      method: "high_frequency_transient_autocorrelation",
      candidateScores: [{ bpm: 96, score: 0.8123 }, { bpm: 192, score: 0.4012 }],
      confidence: 0.7134, alternateTempo: 192, beatGridStatus: "tentative",
      beatTimesSeconds: [0.1, 0.72, 1.35], windowConsensus: { winner: "96", windowCount: 4, observedAgreement: 0.75 },
      independentEstimator: { bpm: 95.8, score: 0.6234 },
      abstentionReason: "Window stability did not meet the reporting gate."
    }};
    const lines = reportV2Render.buildTempoDiagnosticLines(input).join(" ");
    expect(lines).toContain("Possible tempo readings: 96 BPM; 192 BPM.");
    expect(lines).not.toMatch(/confidence|score|probability|detector/i);
    expect(lines).toContain("Tempo readings are broadly consistent across the analyzed sections.");
    expect(lines).not.toContain("observed agreement");
    expect(lines).toContain("Tempo not confirmed");
    expect(lines).toContain("Window stability did not meet the reporting gate");
    expect(lines).not.toMatch(/calibrated|Goertzel|harmonic|FFT/i);
  });

  it("renders plain-language song-key possibilities and abstention", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, harmonicFeatures: {
      method: "fft_harmonic_chroma_ensemble", confidence: 0.8123, segmentAgreement: 0.7,
      analysisWindows: 5, tuningCents: -12.4, tuningEvidenceWindows: 4,
      topCandidates: [{ key: "A", mode: "minor", score: 0.71 }, { key: "C", mode: "major", score: 0.43 }],
      independentEstimator: { key: "C", mode: "major", score: 0.51, margin: 0.08 },
      independentEstimatorDisagrees: true, relativeMajorMinorAmbiguity: true,
      limitation: "Independent estimators disagree; no single key is asserted."
    }};
    const lines = reportV2Render.buildKeyDiagnosticLines(input).join(" ");
    expect(lines).toContain("Possible song keys: A minor; C major.");
    expect(lines).toContain("Song-key readings are broadly consistent across the analyzed sections.");
    expect(lines).not.toContain("Tuning offset");
    expect(lines).not.toMatch(/Goertzel|score|margin|confidence|harmonic|FFT/i);
    expect(lines).toContain("Different key readings were returned; no single key is confirmed.");
    expect(lines).toContain("relative major/minor pair");
    expect(lines).toContain("no single key is asserted");
  });
});

describe("v2 gated report pages", () => {
  it("provides a useful positioning decision panel when no lane evidence exists", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.laneHypotheses = [];
    input.assessment.adjacentLanes = [];
    input.evidence.genre = null;
    const lines = buildPositioningLines(input);
    expect(lines.join(" ")).toContain("Genre positioning is not established");
    expect(lines.join(" ")).toContain("music-platform genre listing");
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
    expect(pdf.getPageCount()).toBe(12);
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
    expect(pdf.getPageCount()).toBe(12);
  });

  it("omits every gated page for a minimal audio-only fixture", async () => {
    const input = { ...metadataOnlyFixture, evidence: { fixture: true, auditType: "AUDIO-ONLY", artist: null, title: null }, sonicDna: { provenance: "fixture", bpm: null, key: null, mode: null, tempoConfidence: 0, keyConfidence: 0 } };
    expect((await PDFDocument.load(await generateAuditReportV2(input as any))).getPageCount()).toBe(9);
  });
});
