import { describe, expect, it } from "vitest";
import { planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("uploaded master provenance in reports", () => {
  it("reports an observed master submission even when Sonic DNA measurements are absent", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = null;
    input.evidence = {
      ...input.evidence,
      fixture: false,
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
      sourceCombination: "master_and_dsp",
    };

    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");

    expect(report).toContain("Uploaded master submitted; master-derived measurements are reported separately.");
    expect(report).toContain("Master audio submitted; master-derived Sonic DNA measurements unavailable.");
    expect(report).not.toContain("Not measured: no master audio supplied.");
  });
  it("reports measured integrated loudness and explicitly discloses unperformed vocal analysis", () => {
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
    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");
    expect(report).toContain("Integrated loudness (EBU R128): -11.3 LUFS");
    expect(report).toContain("Loudness range (EBU R128 LRA): 4.2 LU");
    expect(report).toContain("True peak: -1.1 dBFS");
    expect(report).toContain("Source format: 48000 Hz; 2 channel(s)");
    expect(report).toContain("Spectral profile: centroid 1850 Hz");
    expect(report).toContain("RMS envelope spread (p95/p10; internal proxy): 13.1 dB");
    expect(report).toContain("Vocal analysis: Not performed");
    expect(report.toLowerCase()).toContain("vocal presence/absence is unknown");
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
    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");
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
    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");
    expect(report).toContain("Submitted source combination: Combined — uploaded master audio + submitted DSP catalog link.");
    expect(report).toContain("No DSP provider lookup result was recorded");
  });

  it("shows low-confidence key and tempo candidates with their detector abstention diagnostics", () => {
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
    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");
    expect(report).toContain("Tempo: Tentative candidate — 190.0 BPM");
    expect(report).toContain("abstention: Tempo candidate prominence is too weak");
    expect(report).toContain("Key / mode: Tentative segment candidate — A minor (3/4 analysed windows; not verified)");
    expect(report).toContain("Key and mode confidence was below threshold");
    expect(report).not.toContain("Key / mode: A minor");
  });

});
