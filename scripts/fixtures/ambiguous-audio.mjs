import { partialAudioFixture } from "./sample-report-input.mjs";

/**
 * Generic synthetic regression case for ambiguous identity and low-confidence
 * audio analysis. Values are test-only and are not observations of a real track.
 */
export const ambiguousAudioFixture = structuredClone(partialAudioFixture);
ambiguousAudioFixture.auditId = "ambiguous-audio-low-confidence-regression";
ambiguousAudioFixture.evidence = {
  ...ambiguousAudioFixture.evidence,
  artist: "Generic Test Artist",
  title: "Ambiguous Audio Sample",
  album: "Sample Release",
  releaseDate: "2026-01-01",
  genre: null,
  fixture: true,
  fieldProvenance: {
    ...ambiguousAudioFixture.evidence.fieldProvenance,
    album: "id3",
  },
  reconciliation: {
    conflicts: [{ field: "album", values: ["Sample Release - EP", "Sample Release"] }],
  },
};
ambiguousAudioFixture.sonicDna = {
  ...ambiguousAudioFixture.sonicDna,
  bpm: 128,
  alternateTempo: 64,
  tempoCandidateBpm: 128,
  tempoConfidence: 0,
  keyTuningCents: 14,
  tuningEvidenceWindows: 3,
  rhythmFeatures: {
    status: "insufficient_evidence",
    bpm: 128,
    alternateTempo: 64,
    confidence: 0,
    method: "high_frequency_transient_autocorrelation",
    candidateScores: [{ bpm: 128, score: 0 }],
    abstentionReason: "Signal-prominence confidence is zero; tempo withheld.",
  },
  harmonicFeatures: {
    limitation: "Harmonic candidates disagree across audio segments; no key or mode is asserted.",
    topCandidates: [{ key: "C", mode: "major", score: 0.31 }, { key: "A", mode: "minor", score: 0.28 }],
  },
  key: null,
  mode: null,
  keyConfidence: 0.06,
  keySegmentAgreement: 0.16,
  genreClassification: {
    primaryGenre: null,
    genres: [],
    abstained: true,
    status: "disabled",
  },
};
ambiguousAudioFixture.assessment = {
  ...ambiguousAudioFixture.assessment,
  executiveSummary: "This generic regression fixture contains a zero-confidence tempo candidate and an inconclusive harmonic-key result. Those values must not be promoted into confirmed musical or commercial claims.",
  creativeIdentity: "This synthetic regression fixture verifies abstention, source-conflict disclosure and commercial evidence handling. It does not describe a real recording or a newly analyzed audio master.",
  aAndRPositioning: {
    primaryLane: "Unconfirmed",
    adjacentLanes: [],
    rationale: "No definitive provider-backed primary genre is available in this fixture.",
  },
  commercialRead: {
    marketability: "high",
    rationale: "This deliberately unsupported commercial verdict verifies deterministic correction when verified audience and campaign metrics are absent.",
  },
  evidenceGaps: ["Release identity remains ambiguous across supplied metadata."],
  risks: ["Release identity is unresolved and must not be treated as confirmed."],
  scorecard: {
    ...ambiguousAudioFixture.assessment.scorecard,
    tempoLaneFit: { score: 80, rationale: "The intentionally populated score tests whether an unsupported tempo candidate is removed from the report." },
    rhythmicConsistency: { score: 75, rationale: "The intentionally populated score tests whether a zero-confidence tempo candidate is prevented from supporting rhythmic consistency." },
    metadataCompleteness: { score: 35, rationale: "The conflicting release metadata must not be treated as a verified identity." },
  },
};
