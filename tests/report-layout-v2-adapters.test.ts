import { describe, expect, it } from "vitest";
import { adaptReportV2, buildDecisionDimensions } from "../src/reports/v2/adapters.js";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";
import { metadataOnlyFixture, fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("v2 read-only evidence adapters", () => {
  it("withholds zero-confidence tempo and low-confidence key candidates", () => {
    const data = adaptReportV2(ambiguousAudioFixture as any);
    expect(data.tempo.value).toBeNull();
    expect(data.tempo.confidence).toBe("Low");
    expect(data.key.value).toBeNull();
    expect(data.key.confidence).toBe("Low");
    expect(data.comparables).toBeNull();
    expect(data.sonicAxes).toBeNull();
  });

  it("returns null for gated evidence absent from an audio-only fixture", () => {
    const input = { ...metadataOnlyFixture, evidence: { ...metadataOnlyFixture.evidence, artist: null, title: null } };
    const data = adaptReportV2(input as any);
    expect(data.structure).toBeNull();
    expect(data.energySeries).toBeNull();
    expect(data.sonicAxes).toBeNull();
    expect(data.comparables).toBeNull();
    expect(data.moments).toBeNull();
    expect(data.hasVerifiedCommercialEvidence).toBe(false);
  });

  it("accepts complete page-gating evidence only when every required value is valid and source-attributed", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      tempoConfidence: 0.9,
      keyConfidence: 0.9,
      keySegmentAgreement: 0.9,
      structure: [{ label: "Intro", startSeconds: 0, endSeconds: 12 }],
      energyOverTime: [{ timeSeconds: 0, value: 20 }, { timeSeconds: 12, value: 70 }],
      sonicDnaAxes: Object.fromEntries(["Rhythm", "Harmony", "Texture", "Vocal", "Space"].map((name) => [name, { score: 70, note: "Fixture-only note" }])),
      flaggedMoments: [{ timestampSeconds: 12, title: "Hook entry", note: "Fixture-only observation", tag: "Strength" }],
    };
    input.evidence.verifiedComparables = [{
      title: "Fixture Comparable", year: 2024, lane: "Fixture lane", similarity: 75,
      basis: "Fixture-only arrangement comparison", source: "fixture-only source",
    }];
    input.evidence.commercialMetrics = { verified: true, source: "fixture-only source", reportingPeriod: "fixture-only period", streams: 100 };
    const data = adaptReportV2(input);
    expect(data.structure).toHaveLength(1);
    expect(data.energySeries).toHaveLength(2);
    expect(Object.keys(data.sonicAxes ?? {})).toHaveLength(5);
    expect(data.comparables).toHaveLength(1);
    expect(data.moments).toHaveLength(1);
    expect(data.hasVerifiedCommercialEvidence).toBe(true);
  });

  it("rejects incomplete five-axis data, unsourced comparables and non-monotonic time series", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      sonicDnaAxes: { Rhythm: { score: 80 }, Harmony: { score: 70 }, Texture: { score: 60 }, Vocal: { score: 50 } },
      energyOverTime: [{ timeSeconds: 5, value: 20 }, { timeSeconds: 4, value: 30 }],
    };
    input.evidence.verifiedComparables = [{ title: "No source", year: 2024, lane: "Lane", similarity: 80, basis: "Basis" }];
    const data = adaptReportV2(input);
    expect(data.sonicAxes).toBeNull();
    expect(data.energySeries).toBeNull();
    expect(data.comparables).toBeNull();
  });

  it("renders measured loudness components even when no composite energy confidence exists", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      energy: null,
      energyConfidence: null,
      loudnessConfidence: null,
      loudnessLufs: -15.1,
      loudnessRangeLu: 10.8,
      truePeakDbfs: -2.3,
      rmsLevelDbfs: -18.4,
    };
    const data = adaptReportV2(input);
    expect(data.energy.value).toContain("Integrated loudness -15.1 LUFS");
    expect(data.energy.value).toContain("Loudness range 10.8 LU");
    expect(data.energy.value).toContain("True peak -2.3 dBFS");
    expect(data.energy.value).toContain("RMS level -18.4 dBFS");
  });

  it("splits the verdict into conservative audio, identity, market and release-readiness dimensions", () => {
    const input = structuredClone(metadataOnlyFixture) as any;
    const initial = buildDecisionDimensions(input);
    expect(initial.map(item => item.name)).toEqual(["Audio", "Identity", "Market", "Release readiness"]);
    expect(initial.map(item => item.status)).toEqual(["NOT MEASURED", "UNVERIFIED", "NOT ESTABLISHED", "NOT CLEARED"]);

    input.sonicDna = {
      ...input.sonicDna,
      provenance: "uploaded_audio_master",
      bpm: 120,
      tempoConfidence: 0.9,
      key: "C",
      mode: "major",
      keyConfidence: 0.9,
      keySegmentAgreement: 0.9,
      loudnessLufs: -14.2,
    };
    input.evidence = {
      ...input.evidence,
      artist: "Fixture Artist",
      title: "Fixture Track",
      isrc: "USAAA2600001",
      sourceProviders: ["tidal", "apple_music"],
      fieldProvenance: { artist: "tidal", title: "apple_music", isrc: "tidal" },
      reconciliation: { reconciledFields: ["artist", "title", "isrc"], conflicts: [] },
      commercialMetrics: { verified: true, source: "fixture provider", reportingPeriod: "fixture period", streams: 1234 },
      rightsClearanceVerified: true,
      deliveryConfirmed: true,
      releaseStatusVerified: true,
      masterApprovalVerified: true,
    };
    const complete = buildDecisionDimensions(input);
    expect(complete.map(item => item.status)).toEqual(["MEASURED", "CROSS-CHECKED", "PERFORMANCE VERIFIED", "GATES VERIFIED"]);
    expect(complete[0].basis).toContain("Only supported findings are presented");
    expect(complete[0].basis).not.toMatch(/confidence|Goertzel|harmonic/i);
    expect(complete[3].basis).toContain("All four required release gates");

    input.evidence.reconciliation = { reconciledFields: ["artist", "title"], conflicts: [{ field: "isrc" }] };
    input.evidence.commercialMetrics = undefined;
    input.evidence.verifiedComparables = [{
      title: "Fixture comparable", year: 2024, lane: "Fixture lane", similarity: 70,
      basis: "Fixture-only comparison", source: "fixture provider",
    }];
    const conflict = buildDecisionDimensions(input);
    expect(conflict[1].status).toBe("CONFLICTS OPEN");
    expect(conflict[2].status).toBe("CATALOGUE CONTEXT ONLY");
  });

  it("does not print half-time or double-time BPM candidates outside 40–220 BPM", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { ...input.sonicDna, bpm: 55, tempoCandidateBpm: 55, tempoConfidence: 0.1 };
    const data = adaptReportV2(input);
    expect(data.notYetMeasured.join(" ")).not.toContain("27.5 BPM");
    expect(data.notYetMeasured.join(" ")).toContain("55 BPM");
  });
});
