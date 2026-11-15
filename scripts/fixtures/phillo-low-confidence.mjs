import { partialAudioFixture } from "./sample-report-input.mjs";

/**
 * Synthetic regression case populated with the previously observed Phillo
 * failure values. This is not the production PDF or a fresh analysis of audio.
 */
export const philloLowConfidenceFixture = structuredClone(partialAudioFixture);
philloLowConfidenceFixture.auditId = "phillo-low-confidence-regression-fixture";
philloLowConfidenceFixture.evidence = {
  ...philloLowConfidenceFixture.evidence,
  artist: "STUNIXX",
  title: "Phillo",
  album: "Hole-Hearted",
  releaseDate: "2025-08-24",
  genre: "Afro Soul",
  fixture: true,
  fieldProvenance: {
    ...philloLowConfidenceFixture.evidence.fieldProvenance,
    album: "id3",
  },
  reconciliation: {
    conflicts: [{ field: "album", values: ["Hole-Hearted - EP", "Hole-Hearted"] }],
  },
};
philloLowConfidenceFixture.sonicDna = {
  ...philloLowConfidenceFixture.sonicDna,
  bpm: 156,
  alternateTempo: 78,
  tempoConfidence: 0,
  rhythmFeatures: {
    status: "measured",
    bpm: 156,
    alternateTempo: 78,
    confidence: 0,
    method: "amplitude_envelope_autocorrelation",
    abstentionReason: null,
  },
  key: null,
  mode: null,
  keyConfidence: 0.0608,
  keySegmentAgreement: 0.1667,
  genreClassification: {
    primaryGenre: null,
    genres: [],
    abstained: true,
    status: "disabled",
  },
};
philloLowConfidenceFixture.assessment = {
  ...philloLowConfidenceFixture.assessment,
  executiveSummary: "The supplied regression fixture contains a zero-confidence 156 BPM tempo candidate and an inconclusive harmonic-key result. Those values must not be promoted into confirmed musical or commercial claims.",
  creativeIdentity: "This synthetic regression fixture reproduces the metadata and analysis evidence boundaries observed in the Phillo audit. It is designed to verify abstention, source conflict disclosure and commercial evidence handling rather than to describe a newly analyzed recording.",
  aAndRPositioning: {
    primaryLane: "Afrobeats",
    adjacentLanes: ["Afro Soul"],
    rationale: "These intentionally unsupported lane labels reproduce the narrative overreach being tested. No definitive provider-backed primary genre is available in the fixture.",
  },
  commercialRead: {
    marketability: "high",
    rationale: "This deliberately unsupported commercial verdict exists to verify deterministic correction when verified audience and campaign metrics are absent.",
  },
  scorecard: {
    ...philloLowConfidenceFixture.assessment.scorecard,
    tempoLaneFit: { score: 80, rationale: "The intentionally populated score tests whether an unsupported tempo candidate is removed from the report." },
    rhythmicConsistency: { score: 75, rationale: "The intentionally populated score tests whether a zero-confidence tempo candidate is prevented from supporting rhythmic consistency." },
  },
};
