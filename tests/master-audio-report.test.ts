import { describe, expect, it } from "vitest";
import {
  planAuditReportPages,
  signalDashboardRowsForReport,
  sonicDashboardRowsForReport,
  type AuditReportInput,
} from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

const rows = (input: AuditReportInput) => ({
  musical: sonicDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown> | null, Boolean(input.sonicDna)),
  signal: signalDashboardRowsForReport(input.sonicDna as unknown as Record<string, unknown> | null, Boolean(input.sonicDna)),
});
const reportText = (input: AuditReportInput, tier: "sample" | "full" = "full") =>
  planAuditReportPages(input, tier).flatMap((section) => [section.title, ...section.text]).join(" ");

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
    expect(musical.find((row) => row.label === "RMS ENVELOPE SPREAD dB")?.value).toBe("13.1");
    expect(signal.find((row) => row.label === "SAMPLE RATE HZ")?.value).toBe("48000");
    expect(signal.find((row) => row.label === "CHANNELS")?.value).toBe("2");
    expect(signal.find((row) => row.label === "SPECTRAL CENTROID HZ")?.value).toBe("1850");
    expect(signal.find((row) => row.label === "SPECTRAL BANDWIDTH HZ")?.value).toBe("900");
    expect(signal.find((row) => row.label === "SPECTRAL ROLLOFF HZ")?.value).toBe("6200");
    expect(signal.find((row) => row.label === "ZERO CROSSING RATE")?.value).toBe("0.0450");
    expect(report).not.toMatch(/Vocal analysis: Not performed|vocal presence\/absence is unknown|temporarily disabled to keep the audit worker|learned audio model: disabled/i);
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
    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      moodTags: ["Moderate RMS level", "Elevated zero-crossing rate"],
      genreClassification: { primaryGenre: "Pop", abstained: false, genres: [{ label: "Pop", sources: ["apple_music"] }], model: { status: "disabled" } },
    };
    const report = reportText(input, "sample");
    expect(report).toContain("Mood alignment was not asserted because no source-attributed DSP mood tags were available");
    expect(report).not.toContain("Mood classification: Not performed");
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
    expect(musical.find((row) => row.label === "RMS ENVELOPE SPREAD dB")?.value).toBe("22.4");
    expect(musical.find((row) => row.label === "LOUDNESS RANGE LRA")?.value).toBe("10.8");
    expect(report).not.toMatch(/healthy measured dynamic range of 22\.36 dB/i);
  });
});
