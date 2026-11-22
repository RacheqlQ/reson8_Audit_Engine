import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildCoverKeyLabel, buildRecordingOverviewKeyLabel, normalizeCircleNote } from "../src/reports/v2/render.js";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { buildPositioningLines, buildNextActionLine, buildReleaseFramingLine, buildIdentityReconciliationRows, generateAuditReportV2 } from "../src/reports/v2/render.js";
import * as reportV2Render from "../src/reports/v2/render.js";
import { sanitizePublicReportLine } from "../src/reports/v2/public-language.js";
import { buildArNotesDecisionContext } from "../src/reports/generate-audit-report.js";
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
    input.sonicDna = { ...input.sonicDna, bpm: null, tempoConfidence: 0.7134, rhythmFeatures: {
      method: "high_frequency_transient_autocorrelation",
      candidateScores: [{ bpm: 96, score: 0.8123 }, { bpm: 192, score: 0.4012 }],
      confidence: 0.7134, alternateTempo: 192, beatGridStatus: "tentative",
      beatTimesSeconds: [0.1, 0.72, 1.35], windowConsensus: { winner: "96", windowCount: 4, observedAgreement: 0.75 },
      independentEstimator: { bpm: 95.8, score: 0.6234 },
      abstentionReason: "Window stability did not meet the reporting gate."
    }};
    const lines = reportV2Render.buildTempoDiagnosticLines(input).join(" ");
    expect(lines).toContain("Retained tempo candidates: 96 BPM (raw score 0.812); 192 BPM (raw score 0.401).");
    expect(lines).toContain("Primary detector raw confidence: 0.713");
    expect(lines).toContain("Candidate window consensus: 96 across 4 windows; observed agreement 75%.");
    expect(lines).toContain("Tempo abstention: Window stability did not meet the reporting gate.");
    expect(lines).not.toMatch(/Goertzel|harmonic|FFT/i);
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
    expect(pdf.getPageCount()).toBe(13);
  });

  it("keeps the five narrative pages after page 9 and omits unsupported analytical stub pages", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, sonicDnaAxes: null, sonicAxes: null, energyOverTime: null, energySeries: null,
      bpm: null, tempoBpm: null, key: null, musicalKey: null, energy: null, rmsEnergy: null, rmsLevelDbfs: null, loudnessLufs: null, tonalResolution: null };
    input.tonalResolution = { status: "UNAVAILABLE", tonic: null, mode: null, reasonCodes: ["INSUFFICIENT_TONAL_EVIDENCE"], candidates: [] };
    input.assessment = { ...input.assessment, headlineScore: null, scoreDrivers: [], executionTimeline: [] };
    input.realMasterContract = null;
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(pdf.getPageCount()).toBe(13);
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
    expect(pdf.getPageCount()).toBe(13);
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
    expect(pdf.getPageCount()).toBe(14);
  });

  it("omits every gated page for a minimal audio-only fixture", async () => {
    const input = { ...metadataOnlyFixture, evidence: { fixture: true, auditType: "AUDIO-ONLY", artist: null, title: null }, sonicDna: { provenance: "fixture", bpm: null, key: null, mode: null, tempoConfidence: 0, keyConfidence: 0 } };
    expect((await PDFDocument.load(await generateAuditReportV2(input as any))).getPageCount()).toBe(8);
  });
});

describe("v2 loudness metric card sizing", () => {
  it("keeps multi-reading loudness text compact enough to match the tempo and key cards", () => {
    const loudness = reportV2Render.metricCardValueLayout("LOUDNESS / SIGNAL");
    const tempo = reportV2Render.metricCardValueLayout("TEMPO");
    const key = reportV2Render.metricCardValueLayout("SONG KEY");
    expect(loudness.fontSize).toBe(7.2);
    expect(loudness.fontSize).toBeLessThan(tempo.fontSize);
    expect(loudness.lineHeight).toBe(8.5);
    expect(loudness.maxLines).toBe(4);
    expect(loudness.cardHeight).toBe(tempo.cardHeight);
    expect(loudness.cardHeight).toBe(key.cardHeight);
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
    expect(plan).toMatch(/day-90 performance review/i);
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


describe("public PDF measurement formatting", () => {
  it("preserves loudness units and labels while removing dead-end market verdicts", () => {
    const metrics = sanitizePublicReportLine("Integrated loudness -11.4 LUFS · Loudness range 5.0 LU · True peak +0.8 dBFS · RMS signal level -13.2 dBFS");
    expect(metrics).toContain("Integrated loudness -11.4 LUFS");
    expect(metrics).toContain("True peak +0.8 dBFS");
    expect(metrics).toContain("RMS signal level -13.2 dBFS");
    expect(metrics).not.toMatch(/overall playback level|peak level/i);
    expect(sanitizePublicReportLine("Market evidence: Insufficient — no verified commercial record.")).toContain("Market proposition: PROPOSED");
    expect(sanitizePublicReportLine("INSUFFICIENT EVIDENCE")).toBe("PROPOSED REVIEW");
    expect(sanitizePublicReportLine("low-confidence audio evidence")).toBe("audio evidence");
    expect(sanitizePublicReportLine("Keep lane positioning unconfirmed until sources are checked.")).toContain("proposed search direction");
    expect(sanitizePublicReportLine("Rights are not cleared for outreach.")).toContain("pending rights checks");
  });
});


describe("v2 strengths and risks count integrity", () => {
  it("counts only substantive documented items and keeps the rendered lists in sync", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.strengths = ["Clear hook potential", "Not supplied in the assessment."];
    input.assessment.risks = ["Release identity conflict", "Rights clearance pending", "Not supplied"];
    expect(reportV2Render.buildStrengthRiskSummary(input)).toEqual({
      strengths: ["Clear hook potential"],
      risks: ["Release identity conflict", "Rights clearance pending"],
      strengthCount: 1,
      riskCount: 2,
    });
  });
});


describe("post-release campaign framing", () => {
  it("marks pre-release and release-window actions as historical when the date is determined in the past", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-08-24";
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    input.generatedAt = "2026-11-21T00:00:00.000Z";
    const labels = reportV2Render.buildReleaseCampaignLabels(input);
    expect(labels.preRelease).toMatch(/historical; already passed/i);
    expect(labels.releaseWindow).toMatch(/historical; already passed/i);
    expect(labels.postRelease).toMatch(/post-release growth/i);
    expect(labels.first30).toMatch(/post-release/i);
    expect(labels.days3160).toMatch(/post-release/i);
    expect(labels.days6190).toMatch(/post-release/i);
  });
});


describe("v2 tempo and tonal status reporting", () => {
  it("preserves ambiguous 55/110 BPM candidates, raw confidence and window consensus without confirming either", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna.rhythmFeatures = {
      bpm: null,
      candidateBpms: [55, 110],
      candidateScores: [{ bpm: 55, score: 0.41 }, { bpm: 110, score: 0.39 }],
      confidence: 0.24,
      alternateTempo: 110,
      windowConsensus: { winner: "55", windowCount: 4, observedAgreement: 0.45 },
      abstentionReason: "Transient prominence is weak and the half/double-time candidates are unresolved."
    };
    input.sonicDna.bpm = null;
    const lines = reportV2Render.buildTempoDiagnosticLines(input).join(" ");
    expect(lines).toContain("55 BPM");
    expect(lines).toContain("110 BPM");
    expect(lines).toMatch(/0\.24/);
    expect(lines).toMatch(/45%|0\.45/);
    expect(lines).toMatch(/candidate|not confirmed|abstain/i);
    expect(adaptReportV2(input).tempo.value).toBeNull();
  });

  it("keeps provisional tonal status and ambiguity consistent between cover, overview and diagnostics", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.tonalResolution = {
      status: "PROVISIONAL", tonic: "D", mode: "major",
      windowAgreement: 0.48, bootstrapShare: 0.52, validWindowCount: 4, downbeatAnchorWindowCount: 2, cadenceWeightedWindowCount: 1,
      candidates: [{ tonic: "D", mode: "major" }, { tonic: "B", mode: "minor" }],
      reasonCodes: ["LOW_WINDOW_CONSENSUS", "RELATIVE_MAJOR_MINOR_AMBIGUITY"]
    };
    const data = adaptReportV2(input);
    expect(buildCoverKeyLabel(input, data)).toBe("Possible: D major");
    expect(buildRecordingOverviewKeyLabel(data)).toBe("Provisional: D major");
    const diagnostics = reportV2Render.buildKeyDiagnosticLines(input).join(" ");
    expect(diagnostics).toMatch(/provisional/i);
    expect(diagnostics).toMatch(/relative major\/minor/i);
    expect(diagnostics).toMatch(/window agreement: 48%/i);
    expect(diagnostics).toMatch(/bootstrap rank share/i);
    expect(diagnostics).toMatch(/bass-root anchors: 2\/4 windows/i);
    expect(diagnostics).toMatch(/outro weighting: 1 window/i);
  });
});

describe("v2 A&R Notes page acceptance", () => {
  it("uses complete decision sentences without ellipsis truncation", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.executiveSummary = "A long evidence-led decision summary that must wrap naturally across the available A&R Notes card width without losing the final sentence or inserting a truncation marker. The second sentence explains the actual assessment basis and should remain complete.";
    input.assessment.evidenceGaps = ["...", ""];
    input.assessment.risks = [];
    input.assessment.releaseStrategy = { recommendation: "Not supplied" };
    const context = buildArNotesDecisionContext(input);
    expect(context.summary).not.toContain("...");
    expect(context.summary).toMatch(/Decision basis:.*\./);
    expect(context.summary).toMatch(/Open diligence:.*\./);
    expect(context.summary).toMatch(/Next action:.*\./);
    expect(context.openDiligence).toBe("No additional identity, rights or source gap was recorded in the assessment.");
    expect(context.nextAction).not.toBe("Not supplied.");
  });

  it("renders the exact editable fields and a working-notes region at least 35 percent of A4 height in both tiers", async () => {
    const expected = ["ar_notes", "ar_owner", "ar_followup_date", "ar_decision_hold", "ar_decision_reaudit", "ar_decision_proceed"].sort();
    for (const tier of ["sample", "full"] as const) {
      const pdf = await PDFDocument.load(await generateAuditReportV2(structuredClone(fullAudioFixture) as any, tier));
      const names = pdf.getForm().getFields().map(field => field.getName()).sort();
      expect(names).toEqual(expected);
      const form = pdf.getForm();
      const notesField = form.getTextField("ar_notes");
      expect(notesField.isMultiline()).toBe(true);
      const notesRect = notesField.acroField.getWidgets()[0].getRectangle();
      const ownerRect = form.getTextField("ar_owner").acroField.getWidgets()[0].getRectangle();
      const followupRect = form.getTextField("ar_followup_date").acroField.getWidgets()[0].getRectangle();
      const holdRect = form.getCheckBox("ar_decision_hold").acroField.getWidgets()[0].getRectangle();
      expect(notesRect.x).toBeCloseTo(41.5, 0);
      expect(notesRect.width).toBeCloseTo(512.28, 0);
      expect(notesRect.y).toBeGreaterThanOrEqual(76);
      expect(notesRect.height).toBeGreaterThanOrEqual(295);
      expect(ownerRect.y).toBeCloseTo(53, 0);
      expect(followupRect.y).toBeCloseTo(53, 0);
      expect(holdRect.y).toBeCloseTo(55, 0);
      expect(notesRect.y).toBeGreaterThan(ownerRect.y + ownerRect.height);
      expect(pdf.getPages().at(-1)?.getWidth()).toBeCloseTo(595.28, 1);
      expect(pdf.getPages().at(-1)?.getHeight()).toBeCloseTo(841.89, 1);
    }
  });

  it("uses persisted verdict dimensions for all four A&R Notes chip values", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.decisionDimensions = [
      { name: "Audio", status: "MEASURED", basis: "Uploaded-master measurements are present." },
      { name: "Identity", status: "CONFLICTS OPEN", basis: "Recording identity conflicts remain unresolved." },
      { name: "Market", status: "PROPOSED", basis: "Market positioning is a provisional thesis." },
      { name: "Release readiness", status: "PENDING RIGHTS CHECKS", basis: "Rights and clearance are not confirmed." }
    ];
    const chips = reportV2Render.buildArNotesStatusChips(input);
    const verdicts = adaptReportV2(input).decisionDimensions;
    expect(verdicts).toEqual(input.decisionDimensions);
    expect(chips.map((chip: any) => chip.value)).toEqual(["MEASURED", "CONFLICTS OPEN", "PROPOSED", "PENDING RIGHTS CHECKS"]);
    expect(chips.map((chip: any) => chip.value)).toEqual(verdicts.map(dimension => dimension.status));
    expect(chips.map((chip: any) => chip.label)).toEqual(["AUDIO", "IDENTITY", "MARKET", "RELEASE READINESS"]);
  });
});


describe("ISRC strategy presentation", () => {
  it("states the unresolved identifier conflict and names the non-ISRC evidence fallback", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.marketPlacement = {
      isrcStrategy: {
        status: "pending_verification",
        route: "NON_ISRC_FALLBACK",
        isrc: null,
        source: null,
        conflicts: ["USSM10501515", "GBAYE0601498"],
        nonIsrcEvidence: ["measured tempo", "provisional tonal candidates", "embedded audio tags"],
        requiredActions: ["Resolve the ISRC conflict before external pitching."]
      }
    };
    const lines = buildPositioningLines(input).join(" ");
    expect(lines).toMatch(/ISRC conflict/i);
    expect(lines).toMatch(/measured tempo, provisional tonal candidates, embedded audio tags/i);
    expect(lines).toMatch(/provisional A&R guidance/i);
    expect(lines).toMatch(/ISRC action: Conflicting valid ISRC claims/i);
  });

  it("does not present an available ISRC as proof of a provider match or commercial performance", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.marketPlacement = {
      isrcStrategy: {
        status: "available",
        route: "ISRC_FIRST",
        isrc: "USSM10501515",
        source: "provider recognition",
        conflicts: [],
        nonIsrcEvidence: [],
        requiredActions: []
      }
    };
    const lines = buildPositioningLines(input).join(" ");
    expect(lines).toMatch(/ISRC-keyed catalog and release reconciliation/i);
    expect(lines).toMatch(/does not prove a provider match or commercial performance/i);
    expect(lines).toMatch(/ISRC action: Run catalog and release-reconciliation lookups/i);
  });
});


describe("weak tempo candidate diagnostics", () => {
  it("keeps 55/110 half-double candidates, confidence and window consensus visibly unconfirmed", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      bpm: null,
      tempoConfidence: 0.1647,
      rhythmFeatures: {
        candidateBpms: [55, 110],
        candidateScores: [{ bpm: 55, score: 0.82 }, { bpm: 110, score: 0.51 }],
        confidence: 0.1647,
        alternateTempo: 110,
        abstentionReason: "Transient prominence is weak or ambiguous; candidates are retained for review.",
        windowConsensus: { winner: "55", windowCount: 4, observedAgreement: 0.5 },
        independentEstimator: { bpm: 55, score: 0.47 }
      }
    };
    const lines = buildTempoDiagnosticLines(input).join(" ");
    expect(lines).toMatch(/Tempo status: UNCONFIRMED/);
    expect(lines).toMatch(/Retained tempo candidates: 55 BPM \(raw score 0\.820\); 110 BPM \(raw score 0\.510\)/);
    expect(lines).toMatch(/Half\/double-time alternative: 110 BPM/);
    expect(lines).toMatch(/Independent low-frequency envelope candidate: 55 BPM/);
    expect(lines).toMatch(/observed agreement 50%/);
    expect(lines).toMatch(/Tempo abstention: Transient prominence is weak or ambiguous/);
    expect(lines).not.toMatch(/Confirmed tempo:/);
  });
});
