import { describe, expect, it } from "vitest";
import {
  planAuditReportPages,
  signalDashboardRowsForReport,
  sonicDashboardRowsForReport,
  reportableAssessmentItems,
  type AuditReportInput,
} from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { buildStrengthRiskChartRows, chartPanelHeight, chartPanelLayoutRects, strengthRiskItemsForColumn } from "../src/reports/charts.js";

const rows = (input: AuditReportInput) => ({
  musical: sonicDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown> | null, Boolean(input.sonicDna)),
  signal: signalDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown> | null, Boolean(input.sonicDna)),
});
const reportText = (input: AuditReportInput, tier: "sample" | "full" = "full") =>
  planAuditReportPages(input, tier).flatMap((section) => [section.title, ...section.text]).join(" ");

describe("analysis-to-report integration contracts", () => {
  it("renders provisional predictions and human-readable abstention reasons without internal paths or reason codes", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence = { ...input.evidence, fixture: false, masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } };
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      tempoCandidateBpm: 95,
      tempoConfidence: 0.28,
      rhythmFeatures: { independentEstimator: { bpm: 93.8, score: 0.21 }, windowConsensus: { windowCount: 8, winner: "95", observedAgreement: 0.25 } },
    };
    input.realMasterContract = {
      schemaVersion: "1.0.0", auditId: "audit-real-master",
      source: { sourceKind: "uploaded_master", sourceAudioPath: "uploads/Bend Et.mp3", sha256: "a".repeat(64), mimeType: "audio/mpeg", byteLength: 1024 },
      directSignalMeasurements: [{
        name: "tempo_bpm", status: "unavailable", value: null, unit: "BPM",
        method: "high_frequency_transient_autocorrelation",
        diagnostics: [{ code: "TEMPO_BELOW_REPORTING_THRESHOLD", message: "A provisional candidate was returned." }],
      }],
      calibratedPredictions: [{
        name: "calibrated_audio_mood", status: "unavailable", label: null, probability: null,
        reasonCodes: ["VALIDATED_MODEL_NOT_CONFIGURED"],
        diagnostics: [{ code: "VALIDATED_MODEL_NOT_CONFIGURED", message: "A calibrated model is unavailable; provisional data is in acousticFeatureProfile.predictions.mood." }],
      }],
      provisionalPredictions: [{
        name: "audio_mood", status: "provisional", label: "driving, tense", score: 74, scoreScale: "0-100",
        method: "audio_feature_heuristics_v1", probability: null, featureDrivers: ["spectral_flux"], diagnostics: [],
      }],
      externalRecords: [], strategicSynthesis: [], pipelineDiagnostics: [],
    };
    const report = reportText(input);
    expect(report).toContain("Confirmed tempo: Not reported as a confirmed measurement");
    expect(report).toContain("A tempo candidate was returned but did not meet the reporting threshold");
    expect(report).toContain("PROVISIONAL MOOD DIRECTION: driving, tense (exploratory; confirm by listening)");
    expect(report).toContain("No validated model prediction is available.");
    expect(report).not.toContain("acousticFeatureProfile.predictions");
    expect(report).not.toContain("VALIDATED_MODEL_NOT_CONFIGURED");
    expect(report).not.toContain("TEMPO_BELOW_REPORTING_THRESHOLD");
  });

  it("uses the same sanitized item set for A&R risk lists and summary counts", () => {
    const risks = reportableAssessmentItems([
      "Tempo confidence remains below the reporting threshold.",
      "Vocal analysis: Not performed because no validated vocal model is configured.",
    ]);
    const rows = buildStrengthRiskChartRows([], risks);
    expect(risks).toEqual(["Tempo confidence remains below the reporting threshold."]);
    expect(rows.find((row) => row.label === "Risks")?.value).toBe(risks.length);
    expect(strengthRiskItemsForColumn(rows, "risk")).toHaveLength(risks.length);
  });

  it("removes duplicated RMS-envelope parentheticals without calling the proxy mastering dynamic range", () => {
    const value = "RMS-envelope spread (internal proxy; not mastering RMS-envelope spread (internal proxy; not mastering dynamic range)) of 13.1 dB";
    expect(reportableAssessmentItems([value])).toEqual([
      "RMS-envelope spread (internal proxy; not a mastering dynamic-range measure) of 13.1 dB",
    ]);
  });
});

describe("uploaded master provenance in reports", () => {
  it("reports a submitted master even when completed Sonic DNA measurements are absent", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = null;
    input.evidence = {
      ...input.evidence,
      fixture: false,
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
      sourceCombination: "master_and_dsp",
    };
    const report = reportText(input);
    expect(report).toContain("Uploaded master submitted; master-derived measurements are reported separately.");
    expect(report).toContain("An uploaded master was supplied, but completed master-derived measurements are not available in this report.");
    expect(sonicDashboardRowsForReport(null, false).every((row) => row.value === null)).toBe(true);
    expect(report).not.toContain("Not measured: no master audio supplied.");
  });

  it("renders unit-correct master metrics without disabled-analysis disclosures", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      loudnessLufs: -11.32,
      loudnessRangeLu: 4.2,
      truePeakDbfs: -1.1,
      sampleRate: 48000,
      channels: 2,
      spectralCentroidHz: 1850,
      spectralBandwidthHz: 900,
      spectralRolloffHz: 6200,
      zeroCrossingRate: 0.045,
      dynamicRangeDb: 13.11,
      vocalFeatures: {
        status: "not_analyzed",
        reason: "No vocal separation or vocal-activity model is configured.",
      },
    };
    const report = reportText(input);
    const { musical, signal } = rows(input);
    expect(musical.find((row) => row.label === "INTEGRATED LOUDNESS LUFS")?.value).toBe("-11.3");
    expect(musical.find((row) => row.label === "LOUDNESS RANGE LRA")?.value).toBe("4.2");
    expect(musical.find((row) => row.label === "TRUE PEAK dBFS")?.value).toBe("-1.1");
    expect(musical.find((row) => row.label === "RMS ENVELOPE SPREAD (PROXY) dB")?.value).toBe("13.1");
    expect(signal.find((row) => row.label === "SAMPLE RATE HZ")?.value).toBe("48000");
    expect(signal.find((row) => row.label === "CHANNELS")?.value).toBe("2");
    expect(signal.find((row) => row.label === "SPECTRAL CENTROID HZ")?.value).toBe("1850");
    expect(signal.find((row) => row.label === "SPECTRAL BANDWIDTH HZ")?.value).toBe("900");
    expect(signal.find((row) => row.label === "SPECTRAL ROLLOFF HZ")?.value).toBe("6200");
    expect(signal.find((row) => row.label === "ZERO CROSSING RATE")?.value).toBe("0.0450");
    expect(report).not.toMatch(/Vocal analysis: Not performed|vocal presence\/absence is unknown|temporarily disabled to keep the audit worker|learned audio model: disabled/i);
  });

  it("renders multi-window acoustic feature summaries and extraction provenance", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      acousticFeatureProfile: {
        status: "measured",
        provenance: { featureVersion: "acoustic-profile-v1", windowCount: 24 },
        descriptors: {
          rmsDbfs: { median: -18.25 },
          peakDbfs: { median: -1.4 },
          crestFactorDb: { median: 16.85 },
          spectralFlatness: { median: 0.0123 },
          lowBandEnergyRatio: { median: 0.42 },
          midBandEnergyRatio: { median: 0.51 },
          highBandEnergyRatio: { median: 0.07 },
        },
      },
    };
    const signal = rows(input).signal;
    expect(signal.find((row) => row.label === "WINDOWED RMS MEDIAN DBFS")?.value).toBe("-18.25");
    expect(signal.find((row) => row.label === "WINDOWED PEAK MEDIAN DBFS")?.value).toBe("-1.40");
    expect(signal.find((row) => row.label === "WINDOWED CREST FACTOR DB")?.value).toBe("16.85");
    expect(signal.find((row) => row.label === "SPECTRAL FLATNESS MEDIAN")?.value).toBe("0.0123");
    expect(signal.find((row) => row.label === "LOW BAND ENERGY RATIO")?.value).toBe("0.4200");
    expect(signal.find((row) => row.label === "ACOUSTIC PROFILE / WINDOWING")?.value).toBe("acoustic-profile-v1; 24 windows");
  });

  it("states the combined master-plus-DSP source mode and actual provider lookup outcome", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.evidence = {
      ...input.evidence,
      fixture: false,
      sourceCombination: "master_and_dsp",
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
      catalogSources: [{ platform: "apple_music", status: "recognized", reason: "Provider returned track metadata.", canonicalUrl: "https://music.apple.com/us/album/song/1?i=2" }],
    };
    const report = reportText(input);
    expect(report).toContain("Submitted source combination: Combined — uploaded master audio + submitted DSP catalog link.");
    expect(report).toContain("Apple Music — recognized — Provider returned track metadata. — https://music.apple.com/us/album/song/1?i=2");
  });

  it("discloses when a combined DSP link has no provider lookup result", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.evidence = {
      ...input.evidence,
      fixture: false,
      sourceCombination: "master_and_dsp",
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
      catalogSources: [],
    };
    const report = reportText(input);
    expect(report).toContain("Submitted source combination: Combined — uploaded master audio + submitted DSP catalog link.");
    expect(report).toContain("No DSP provider lookup result was recorded");
  });

  it("withholds low-confidence tempo and key candidates from the technical dashboard", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      bpm: 190,
      tempoConfidence: 0.28,
      rhythmFeatures: {
        status: "insufficient_evidence",
        method: "high_frequency_transient_autocorrelation",
        candidateBpms: [190, 95],
        abstentionReason: "Tempo candidate prominence is too weak to support a reliable result.",
      },
      key: null,
      mode: null,
      keyConfidence: 0.17,
      keySegmentAgreement: 0.75,
      harmonicFeatures: {
        status: "insufficient_evidence",
        method: "fft_harmonic_chroma_ensemble",
        limitation: "Key and mode confidence was below threshold; no key is asserted.",
        segmentChroma: [
          { winningKey: "A", winningMode: "minor" },
          { winningKey: "A", winningMode: "minor" },
          { winningKey: "A", winningMode: "minor" },
          { winningKey: "C", winningMode: "major" },
        ],
      },
      limitations: ["Key and mode confidence was below threshold; no key is asserted."],
    };
    const report = reportText(input);
    const musical = rows(input).musical;
    expect(musical.find((row) => row.label === "TEMPO BPM")?.value).toBeNull();
    expect(musical.find((row) => row.label === "KEY / MODE")?.value).toBeNull();
    expect(report).not.toMatch(/190\.0 BPM|Tempo candidate prominence|candidateBpms|insufficient_evidence|Key and mode confidence|segmentChroma|A minor/);
  });

  it("keeps signal periodicity as a signal metric without inferring vocal presence", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      vocalFeatures: {
        status: "signal_diagnostics_only",
        method: "autocorrelation_voiced_periodicity",
        voicePresence: "undetermined",
        sampledFrames: 100,
        periodicFrames: 62,
        periodicityActivityRatio: 0.62,
        medianFundamentalHz: 220,
        lowerFundamentalHz: 196,
        upperFundamentalHz: 247,
        limitations: ["Periodic energy is not proof of human vocals."],
      },
    };
    const report = reportText(input);
    expect(rows(input).signal.find((row) => row.label === "SIGNAL PERIODICITY ACTIVITY RATIO")?.value).toBe("0.62");
    expect(report).not.toMatch(/Limited signal-periodicity diagnostics|Voice-range periodicity|median 220\.0 Hz|singing, speech, vocal presence\/absence|Vocal analysis: Performed/);
  });

  it("does not present signal descriptors as an audio-derived mood classification", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.evidence = { ...input.evidence, fixture: false, masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } };
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      moodTags: ["Moderate RMS level", "Elevated zero-crossing rate"],
      acousticFeatureProfile: {
        status: "measured",
        predictions: {
          mood: { status: "provisional", labels: ["driving", "tense"], scores: { driving: 74, tense: 63 }, method: "audio_feature_heuristics_v1", probability: null },
          energy: { status: "provisional", label: "high", score: 81, method: "audio_feature_heuristics_v1", probability: null },
        },
      },
      genreClassification: { primaryGenre: "Pop", abstained: false, genres: [{ label: "Pop", sources: ["apple_music"] }], model: { status: "disabled" } },
    };
    const report = reportText(input, "sample");
    expect(report).toContain("No source-attributed DSP mood tags were returned for playlist search.");
    expect(report).toContain("Uploaded-master provisional mood tags: driving, tense");
    expect(report).toContain("Provisional uploaded-master energy estimate: high");
    expect(report).toContain("Mood and energy: these are provisional listening directions from the uploaded recording, not confirmed descriptions.");
    expect(report).toContain("These estimates are derived from the uploaded signal, are not probabilities");
    expect(report).not.toMatch(/model:.*disabled|Learned audio-genre model status/i);
  });

  it("does not repeat RMS-envelope spread as a mastering dynamic-range verdict", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      loudnessRangeLu: 10.8,
      dynamicRangeDb: 22.36,
    };
    input.assessment.strengths = [
      ...input.assessment.strengths,
      "Healthy measured dynamic range of 22.36 dB provides excellent transient preservation.",
    ];
    const report = reportText(input, "sample");
    const musical = rows(input).musical;
    expect(musical.find((row) => row.label === "RMS ENVELOPE SPREAD (PROXY) dB")?.value).toBe("22.4");
    expect(musical.find((row) => row.label === "LOUDNESS RANGE LRA")?.value).toBe("10.8");
    expect(report).not.toMatch(/healthy measured dynamic range of 22\.36 dB/i);
  });

  it("retains a measured tuning-offset candidate across multiple tonal windows when key/mode abstains", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      key: null,
      mode: null,
      keyConfidence: 0.06,
      keySegmentAgreement: 0.16,
      keyTuningCents: 14,
      tuningEvidenceWindows: 3,
      harmonicFeatures: {
        limitation: "Harmonic candidates disagree across audio segments; no key or mode is asserted.",
        topCandidates: [{ key: "C", mode: "major", score: 0.31 }, { key: "A", mode: "minor", score: 0.28 }],
      },
    };
    const tuning = sonicDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown>, true)
      .find((row) => row.label === "TUNING OFFSET CANDIDATE CENTS");
    expect(tuning?.value).toBe("14 (multiple tonal windows; provisional)");
    const chartRects = chartPanelLayoutRects("sonic", sonicDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown>, true));
    expect(chartPanelHeight("sonic")).toBe(340);
    expect(chartRects.some((rect) => rect.id === "shape-sonic-metric-11")).toBe(true);
    expect(chartRects.some((rect) => rect.id === "shape-sonic-metric-12")).toBe(true);
  });

  it("hides internal master paths, humanizes measurement methods, and preserves independent tempo candidates", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence = { ...input.evidence, fixture: false, masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } };
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      bpm: null,
      tempoCandidateBpm: null,
      tempoConfidence: null,
      rhythmFeatures: { independentEstimator: { bpm: 93.8, score: 0.21 } },
      harmonicFeatures: { topCandidates: [{ key: "F#", mode: "major", score: 0.694 }] },
      key: null,
      mode: null,
      keyConfidence: null,
    };
    input.realMasterContract = {
      schemaVersion: "1.0.0", auditId: "audit-real-master",
      source: { sourceKind: "uploaded_master", sourceAudioPath: "private/jobs/job-secret/uploads/Bend Et.mp3", sha256: "b".repeat(64), mimeType: "audio/mpeg", byteLength: 2048 },
      directSignalMeasurements: [
        { name: "rms_level_dbfs", status: "measured", value: -12.4, unit: "dBFS", method: "pcm_rms", measuredAt: "2026-11-20T00:00:00.000Z", diagnostics: [] },
        { name: "spectral_centroid_hz", status: "measured", value: 1800, unit: "Hz", method: "fft_spectral_centroid", measuredAt: "2026-11-20T00:00:00.000Z", diagnostics: [] },
        { name: "sample_rate_hz", status: "measured", value: 48000, unit: "Hz", method: "unrecognized_internal_method_42", measuredAt: "2026-11-20T00:00:00.000Z", diagnostics: [] },
      ],
      calibratedPredictions: [], provisionalPredictions: [], externalRecords: [], strategicSynthesis: [], pipelineDiagnostics: [],
    };
    const report = reportText(input);
    expect(report).toContain("SOURCE FILE: Bend Et.mp3");
    expect(report).not.toContain("private/jobs/job-secret");
    expect(report).not.toContain("job-secret");
    expect(report).toContain("method: PCM RMS signal measurement");
    expect(report).toContain("method: spectral-centroid analysis");
    expect(report).toContain("method: signal-analysis method (technical identifier withheld)");
    const rows = sonicDashboardRowsForReport(input.sonicDna, true);
    expect(rows.find((row) => row.label === "TEMPO CANDIDATE BPM")?.value).toContain("93.8 BPM (provisional; confirm by listening)");
    expect(rows.find((row) => row.label === "PROVISIONAL HALF / DOUBLE-TIME RELATIONS")?.value).toContain("half-time 46.9 BPM; double-time 187.6 BPM");
    expect(rows.find((row) => row.label === "KEY / MODE CANDIDATES")?.value).toContain("F# major");
  });
});
