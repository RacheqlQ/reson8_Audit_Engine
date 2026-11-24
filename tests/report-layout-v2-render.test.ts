import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildCoverKeyLabel, buildCoverTempoLabel, buildRecordingOverviewKeyLabel, normalizeCircleNote } from "../src/reports/v2/render.js";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { buildPositioningLines, buildCommercialStrategyLines, buildNextActionLine, buildReleaseFramingLine, buildIdentityReconciliationRows, generateAuditReportV2 } from "../src/reports/v2/render.js";
import * as reportV2Render from "../src/reports/v2/render.js";
import { sanitizePublicReportLine } from "../src/reports/v2/public-language.js";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("public report language sanitization", () => {
  it("suppresses internal vocal-analysis and model-status notices", () => {
    for (const notice of [
      "Vocal analysis: Not performed - Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.",
      "Vocal presence/absence is unknown and is not inferred.",
      "No vocal conclusion is available because the separation model did not complete.",
      "Learned audio model: disabled.",
      "Detection model status: disabled.",
    ]) expect(sanitizePublicReportLine(notice)).toBe("");
  });
});

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

describe("v2 commercial strategy report integration", () => {
  it("surfaces proposed ISRC coverage and actionable verification gates in existing report sections", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.marketPlacement = {
      isrcCoverage: { status: "RESOLVED", isrc: "NGABC2600001", resolvedVia: "musicbrainz", linkedReleasesCount: 2, matchedPlatforms: ["musicbrainz", "spotify"], catalogPresenceTier: "MULTI_PLATFORM" },
      commercialStrategy: {
        marketVerdict: "PROPOSED", releaseDateVerdict: "DETERMINED", releaseLifecycle: "POST_RELEASE",
        primaryLane: { label: "Afrobeats", verdict: "PROPOSED", rationale: "Tempo and metadata" },
        adjacentLanes: [{ label: "Afro-fusion", verdict: "PROPOSED" }],
        audienceContexts: ["Mood-led late-evening context hypothesis."],
        shortFormAngles: ["Audition excerpt 00:42–00:54."],
        playlistPitchHooks: ["Pitch the reconciled Afrobeats lane."],
        readinessActions: ["Resolve the EP-versus-album metadata variant."],
        syncFit: { status: "BLOCKED", rationale: "Rights clearance remains unverified." },
        kpis: [{ metric: "Metadata parity", target: "100%", verification: "Compare source records." }],
      },
    };
    expect(buildCommercialStrategyLines(input).join(" ")).toContain("PROPOSED");
    expect(buildCommercialStrategyLines(input).join(" ")).toContain("MULTI_PLATFORM");
    const sample = await generateAuditReportV2(input, "sample");
    const full = await generateAuditReportV2(input, "full");
    expect((await PDFDocument.load(sample)).getPageCount()).toBe(8);
    expect((await PDFDocument.load(full)).getPageCount()).toBe(13);
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

describe("v2 cover tempo label", () => {
  it("shows the nominal middle tempo from a 46/92/184 octave vote without implying confirmation", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      bpm: null,
      tempoCandidateBpm: 92,
      tempoConfidence: 0.42,
      rhythmFeatures: {
        ...input.sonicDna.rhythmFeatures,
        tempoVerdict: {
          primary_candidate_bpm: 92,
          octave_alternatives: [46, 184],
          confirmation_status: "CANDIDATE",
          reason_codes: ["OCTAVE_METRICAL_AMBIGUITY"],
        },
      },
    };
    const data = adaptReportV2(input);
    expect(buildCoverTempoLabel(data, input)).toBe("92 BPM · CANDIDATE");
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

describe("v2 chart reconciliation with sanitized assessment data", () => {
  it("uses the same once-sanitized risk set for reconciliation and rendered chart rows", async () => {
    const input = structuredClone(ambiguousAudioFixture) as any;
    if (input.sonicDna && typeof input.sonicDna === "object") input.sonicDna.tempoConfidence = 0;
    input.assessment = {
      ...input.assessment,
      confidence: 0,
      limitations: [
        ...(Array.isArray(input.assessment.limitations) ? input.assessment.limitations : []),
        "Vocal analysis: Not performed - Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.",
        "Vocal presence/absence is unknown and is not inferred.",
        "No vocal conclusion is available because the separation model did not complete.",
        "Learned audio model: disabled.",
        "Detection model status: disabled."
      ],
      executiveSummary: [
        "The recording is a 128 BPM high-energy Afrobeats release.",
        "The track has 24000 streams, strong market demand and high commercial potential.",
        "Verified 24000 monthly listeners prove the campaign is commercially successful.",
        "Further listening and source verification are required before any external decision."
      ].join(" ")
    };
    input.evidence = {
      ...input.evidence,
      playlistDiscovery: {
        status: "partial",
        outcomes: [
          { provider: "spotify", status: "unavailable", reason: "Spotify catalog request failed with HTTP 403" },
          { provider: "apple_music", status: "not_configured", reason: "Apple Music developer token is not configured." }
        ]
      }
    };

    const bytes = await generateAuditReportV2({ ...input, generatedAt: "2026-11-20T00:00:00.000Z" }, "full");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(13);
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

describe("Page 3 vocal arrangement snapshot integration", () => {
  it("renders the signal-derived vocal timeline and KPI data without changing Sample or Full page allocations", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      durationSeconds: 180,
      channels: 2,
      vocalArrangementAnalysis: {
        provenance: "SIGNAL_DERIVED_FROM_UPLOADED_MASTER",
        analysisStatus: "MEASURED_SIGNAL",
        vocalActivityStatus: "SIGNAL_ACTIVITY_DETECTED",
        vocalPresencePct: 34.2,
        vocalBandEnergyDbfs: -22.4,
        vocalMedianF0Hz: 218.5,
        vocalF0RangeHz: { p10: 142.2, p90: 388.1 },
        vocalActivityIntervals: [
          { startSeconds: 18, endSeconds: 47 },
          { startSeconds: 72, endSeconds: 109 },
          { startSeconds: 131, endSeconds: 159 }
        ],
        inferredSections: [
          { index: 1, label: "Intro", startSeconds: 0, endSeconds: 18, provisional: true },
          { index: 2, label: "Verse 1", startSeconds: 18, endSeconds: 72, provisional: true },
          { index: 3, label: "Chorus", startSeconds: 72, endSeconds: 131, provisional: true },
          { index: 4, label: "Outro", startSeconds: 131, endSeconds: 180, provisional: true }
        ],
        detectedTransitions: [
          { id: "T1", timestampSeconds: 18, fromLabel: "Intro", toLabel: "Verse 1", reason: "Vocal onset" },
          { id: "T2", timestampSeconds: 72, fromLabel: "Verse 1", toLabel: "Chorus", reason: "Energy rise" },
          { id: "T3", timestampSeconds: 131, fromLabel: "Chorus", toLabel: "Outro", reason: "Vocal offset" }
        ],
        analysisReason: "Window-derived mid-band activity; not proof of human vocals.",
        labelBasis: "Provisional labels from windowed novelty, RMS, chroma and vocal-band changes."
      },
      vocalFeatures: {
        ...input.sonicDna.vocalFeatures,
        vocalPresencePct: 34.2,
        vocalActivityStatus: "SIGNAL_ACTIVITY_DETECTED"
      }
    };
    const titles = reportV2Render.buildReportSectionTitles(input, "sample");
    const geometry = reportV2Render.snapshotPage3LayoutContract();
    expect(geometry.pageNumber).toBe(3);
    expect(geometry.vocalTop).toBeGreaterThan(geometry.vocalBottom);
    expect(geometry.vocalBottom).toBeGreaterThan(geometry.overviewTop);
    expect(geometry.overviewBottom).toBeGreaterThan(42);
    expect(titles[2]).toBe("Track snapshot");
    expect(titles[3]).toBe("Evidence ledger and scorecard");
    expect(reportV2Render.buildExecutiveSummary(input)).toContain("0:18–0:47");
    expect(reportV2Render.buildVocalCadenceSummaryLine(input)).toContain("0:18–0:47");
    const swotSmart = reportV2Render.buildSwotSmartLines(input).join(" ");
    expect(swotSmart).toContain("0:18");
    expect(swotSmart).toContain("T1 0:18");
    expect(reportV2Render.buildMandatoryArAnswerLines(input)[1]).toContain("Intro 0:00");
    const sample = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    const full = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(sample.getPageCount()).toBe(8);
    expect(full.getPageCount()).toBe(13);
  });

  it("keeps an explicit low-activity fallback with no fabricated pitch or blank structural timeline", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      vocalArrangementAnalysis: {
        provenance: "SIGNAL_DERIVED_FROM_UPLOADED_MASTER",
        analysisStatus: "INSUFFICIENT_SIGNAL",
        vocalActivityStatus: "LOW_VOCAL_ACTIVITY",
        vocalPresencePct: 0,
        vocalBandEnergyDbfs: null,
        vocalMedianF0Hz: null,
        vocalF0RangeHz: null,
        vocalActivityIntervals: [],
        inferredSections: [{ index: 1, label: "Section 1", startSeconds: 0, endSeconds: 180, provisional: true }],
        detectedTransitions: [],
        analysisReason: "Low vocal-band salience and insufficient periodicity for F0 candidates."
      }
    };
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    expect(pdf.getPageCount()).toBe(8);
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

describe("voting-confirmed tempo propagation",()=>{
 it("uses a confirmed voting verdict consistently when the compatibility BPM field is absent",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.sonicDna.bpm=null;
  input.sonicDna.tempoConfidence=null;
  input.sonicDna.rhythmFeatures={
   ...(input.sonicDna.rhythmFeatures??{}),
   tempoVerdict:{
    confirmation_status:"CONFIRMED",primary_candidate_bpm:96,prominence_score:0.91,
    window_agreement:0.9,runner_up_margin:0.2,vote_share:0.95,explanation:"Confirmed by weighted window consensus."
   }
  };
  const data=adaptReportV2(input);
  expect(data.tempo.value).toBe(96);
  expect(data.notYetMeasured.some(line=>/tempo/i.test(line))).toBe(false);
  expect(buildCoverTempoLabel(data,input)).toBe("96 BPM");
  const tempoCard=reportV2Render.metricBlock(data,input).find(block=>block.label==="TEMPO");
  expect(tempoCard).toMatchObject({value:"96 BPM",confidence:"CONFIRMED"});
  expect(reportV2Render.buildConfirmedAudioEvidenceLines(data).join(" ")).toContain("TEMPO INFERENCE · CONFIRMED");
  expect(reportV2Render.buildTempoDiagnosticLines(input)).toContain("Confirmed tempo: 96 BPM.");
 });

 it("uses reliable top-level BPM when rhythm-window details are absent",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  delete input.sonicDna.rhythmFeatures;
  const lines=reportV2Render.buildTempoDiagnosticLines(input);
  expect(lines).toContain("Confirmed tempo: 96 BPM.");
  expect(lines).not.toContain("No tempo result is available from the supplied recording.");
 });
});
