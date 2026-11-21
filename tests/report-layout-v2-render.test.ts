import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildCoverKeyLabel, buildRecordingOverviewKeyLabel, normalizeCircleNote } from "../src/reports/v2/render.js";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
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
    expect(buildNextActionLine(input)).toContain("Confirm the recording identifier and release-version mapping");
  });

  it("compares release date to generatedAt rather than the current clock", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.generatedAt = "2025-01-01T00:00:00.000Z";
    input.evidence.releaseDate = "2025-06-01";
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    expect(buildReleaseFramingLine(input)).toContain("UPCOMING");
    input.generatedAt = "2025-12-01T00:00:00.000Z";
    expect(buildReleaseFramingLine(input)).toContain("POST-RELEASE");
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
    expect(lines).toContain("Different key readings were returned; no single key is confirmed.");
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
    expect(lines.join(" ")).toContain("PROPOSED market thesis");
    expect(lines.join(" ")).toContain("Validation route");
    expect(lines.every((line: string) => line.trim().length > 0)).toBe(true);
  });

  it("omits market, Sonic DNA and moments pages for the Phillo/Stunixx low-confidence reference fixture", async () => {
    const input = structuredClone(ambiguousAudioFixture) as any;
    input.evidence = { ...input.evidence, artist: "Stunixx", title: "Phillo", album: null, isrc: null, upc: null, label: null,
      reconciliation: { conflicts: [{ field: "album", values: ["Hole-Hearted - EP", "Hole-Hearted"] }] } };
    const pdf = await PDFDocument.load(await generateAuditReportV2(input));
    expect(pdf.getPageCount()).toBe(8);
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
    expect(pdf.getPageCount()).toBe(8);
    expect(pdf.getForm().getFields().map(field => field.getName())).toContain("ar_notes");
  });

  it("keeps the five narrative pages and only evidence-supported deep dives", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBe(15);
  });

  it("keeps the five narrative pages after page 9 and omits unsupported analytical stub pages", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, sonicDnaAxes: null, sonicAxes: null, energyOverTime: null, energySeries: null,
      bpm: null, tempoBpm: null, key: null, musicalKey: null, energy: null, rmsEnergy: null, rmsLevelDbfs: null, loudnessLufs: null, tonalResolution: null };
    input.tonalResolution = { status: "UNAVAILABLE", tonic: null, mode: null, reasonCodes: ["INSUFFICIENT_TONAL_EVIDENCE"], candidates: [] };
    input.assessment = { ...input.assessment, headlineScore: null, scoreDrivers: [], executionTimeline: [] };
    input.realMasterContract = null;
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBe(14);
  });

  it("keeps expanded narrative content on its five allocated pages", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.executiveSummary = Array(3).fill(input.assessment.executiveSummary).join(" ");
    input.assessment.strengths = [...input.assessment.strengths, ...Array(5).fill(
      "The arrangement offers a clear opportunity for a human A&R reviewer to test the hook, vocal performance, production balance and listener context against the submitted master."
    )];
    input.assessment.risks = [...input.assessment.risks, ...Array(5).fill(
      "A release decision still requires rights clearance, delivery confirmation, approved final master and source-attributed commercial reporting."
    )];
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBe(15);
  });

  it("adds only the analytical pages supported by optional evidence", async () => {
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
    expect(pdf.getPageCount()).toBe(16);
  });

  it("omits every gated page for a minimal audio-only fixture", async () => {
    const input = { ...metadataOnlyFixture, evidence: { fixture: true, auditType: "AUDIO-ONLY", artist: null, title: null }, sonicDna: { provenance: "fixture", bpm: null, key: null, mode: null, tempoConfidence: 0, keyConfidence: 0 } };
    expect((await PDFDocument.load(await generateAuditReportV2(input as any))).getPageCount()).toBe(9);
  });
});

describe("v2 cover key and playback presentation", () => {
  it("normalizes enharmonic candidate roots to the circle-of-fifths spelling", () => {
    expect(normalizeCircleNote("Db major")).toBe("C#");
    expect(normalizeCircleNote("Bb")).toBe("A#");
    expect(normalizeCircleNote("F# minor")).toBe("F#");
    expect(normalizeCircleNote("unknown")).toBe("");
  });
  it("keeps provisional and unavailable tonal states consistent in the recording overview", () => {
    const provisional = structuredClone(ambiguousAudioFixture) as any;
    expect(buildRecordingOverviewKeyLabel(adaptReportV2(provisional))).toBe("Provisional: C major");
    const confirmed = structuredClone(fullAudioFixture) as any;
    expect(buildRecordingOverviewKeyLabel(adaptReportV2(confirmed))).toBe("A minor");
    const unavailable = structuredClone(metadataOnlyFixture) as any;
    expect(buildRecordingOverviewKeyLabel(adaptReportV2(unavailable))).toBe("Unavailable");
  });
  it("shows the strongest reportable tonal centre on the cover without calling it confirmed", () => {
    const input = structuredClone(ambiguousAudioFixture) as any;
    input.sonicDna.keyConfidence = 0.12;
    const label = buildCoverKeyLabel(input, adaptReportV2(input));
    expect(label).toBe("Possible: C major");
  });
});

  it("uses the adapted tonal resolution when legacy cover inputs no longer carry the resolution payload", () => {
    const ambiguous = structuredClone(ambiguousAudioFixture) as any;
    const adapted = adaptReportV2(ambiguous);
    const legacyInput = {
      ...ambiguous,
      tonalResolution: undefined,
      sonicDna: { ...ambiguous.sonicDna, tonalResolution: undefined, harmonicFeatures: undefined },
    };
    expect(adapted.key.value).toBeNull();
    expect(buildCoverKeyLabel(legacyInput, adapted)).toBe("Possible: C major");

    const unavailable = structuredClone(metadataOnlyFixture) as any;
    const unavailableData = adaptReportV2(unavailable);
    const metadataOnlyInput = { ...unavailable, tonalResolution: undefined };
    expect(buildCoverKeyLabel(metadataOnlyInput, unavailableData)).toBe("Unavailable");
  });


describe("v2 report structure and release framing regressions", () => {
  it("omits evidence-and-limitations and places A&R notes last in both report tiers", () => {
    const sample = reportV2Render.buildReportSectionTitles(fullAudioFixture as any, "sample");
    const full = reportV2Render.buildReportSectionTitles(fullAudioFixture as any, "full");
    expect(sample).not.toContain("Evidence and limitations");
    expect(full).not.toContain("Evidence and limitations");
    expect(sample.at(-1)).toBe("A&R notes");
    expect(full.at(-1)).toBe("A&R notes");
    expect(full).not.toContain("Tempo and energy spectrum");
  });

  it("always supplies a post-release Days 61-90 plan when the assessment omits it", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-08-24";
    input.generatedAt = "2026-11-21T00:00:00.000Z";
    input.assessment.executionPlan = { days30: "Review", days60: "Re-activate", days90: "" };
    const plan = reportV2Render.buildDays6190Plan(input);
    expect(plan).toMatch(/post-release/i);
    expect(plan).toMatch(/curator|playlist/i);
    expect(plan).toMatch(/creator|UGC/i);
    expect(plan).toMatch(/ISRC|UPC|metadata/i);
    expect(plan).toMatch(/performance review/i);
    expect(plan).not.toMatch(/not supplied/i);
  });

  it("marks a source-attributed valid release date as determined and post-release", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-08-24";
    input.generatedAt = "2026-11-21T00:00:00.000Z";
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    const status = reportV2Render.buildReleaseDateStatus(input);
    expect(status.verdict).toBe("DETERMINED");
    expect(status.context).toBe("POST-RELEASE");
    expect(status.source).toContain("Apple Music");
  });
});


describe("v2 final-page and executive report contracts", () => {
  it("builds an executive brief without placeholder text when metadata and audio evidence exist", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-08-24";
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    input.generatedAt = "2026-11-21T00:00:00.000Z";
    input.assessment.executiveSummary = "Executive summary not supplied.";
    const summary = reportV2Render.buildExecutiveSummary(input);
    expect(summary).toContain("Release date DETERMINED: 2025-08-24");
    expect(summary).toContain("post-release");
    expect(summary).toContain("PROPOSED strategic thesis");
    expect(summary).not.toMatch(/not supplied|not provided/i);
  });

  it("keeps the resolved release date status in the identity reconciliation row", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-08-24";
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    const release = buildIdentityReconciliationRows(input).find((row: any) => row.field === "Release date");
    expect(release).toMatchObject({ value: "2025-08-24", status: "DETERMINED", source: "Apple Music" });
  });

  it("keeps the final A&R notes page and removes the limitations and unmeasured spectrum pages", () => {
    const titles = reportV2Render.buildReportSectionTitles(fullAudioFixture as any, "full");
    expect(titles.at(-1)).toBe("A&R notes");
    expect(titles).not.toContain("Evidence and limitations");
    expect(titles).not.toContain("Tempo and energy spectrum");
    expect(titles.join(" ")).not.toMatch(/INSUFFICIENT EVIDENCE|NOT ESTABLISHED/i);
  });
});
