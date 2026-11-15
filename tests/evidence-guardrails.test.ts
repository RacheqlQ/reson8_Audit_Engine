import { describe, expect, it } from "vitest";
import { isReliableKey, isReliableTempo, sanitizeAssessmentForEvidence } from "../src/reports/evidence-guardrails.js";

const baseAssessment = {
  executiveSummary: "The recording is a 156 BPM high-energy release with a strong rhythmic lane.",
  creativeIdentity: "A fast tempo supports a definitive Afrobeats identity.",
  strengths: ["The 156 BPM pulse makes this a high-energy dance-floor record."],
  risks: ["Tempo and groove consistency require review."],
  aAndRPositioning: { primaryLane: "Afrobeats", adjacentLanes: ["Afro Soul"], rationale: "A fast tempo confirms this lane." },
  commercialRead: { marketability: "high", rationale: "The track is commercially attractive and should perform strongly." },
  laneHypothesis: "The 156 BPM tempo points to Afrobeats.",
  releaseStrategy: { recommendation: "Pitch the 156 BPM track to high-energy playlists.", priorities: ["Verify rights and delivery."] },
  promotionPlan: { pitchingAngles: ["Lead with the 156 BPM energy."], playlistCategories: ["High-energy Afrobeats party mixes"] },
  scorecard: {
    tempoLaneFit: { score: 80, rationale: "Tempo supports the lane." },
    rhythmicConsistency: { score: 75, rationale: "The rhythm is consistent." },
  },
  evidenceLabels: [{ label: "OBSERVED", claim: "The track measures 156 BPM.", source: "uploaded_audio_master" }],
};

describe("Phillo evidence guardrails", () => {
  it("rejects zero-confidence tempo even when a BPM value is present", () => {
    expect(isReliableTempo({ bpm: 156, tempoConfidence: 0, rhythmFeatures: { status: "measured" } })).toBe(false);
  });

  it("accepts only bounded BPM with explicit confidence at or above the conservative reporting gate", () => {
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.5 })).toBe(true);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.49 })).toBe(false);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.9, abstentionReason: "ambiguous pulse" })).toBe(false);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.9, rhythmFeatures: { status: "measured", abstentionReason: "ambiguous pulse" } })).toBe(false);
    expect(isReliableTempo({ bpm: 0, tempoConfidence: 0.9 })).toBe(false);
    expect(isReliableTempo({ bpm: null, tempoConfidence: 0.9 })).toBe(false);
  });

  it("withholds key labels unless confidence and segment agreement both reach the 80% reporting target", () => {
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.8, keySegmentAgreement: 0.8 })).toBe(true);
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.79, keySegmentAgreement: 0.95 })).toBe(false);
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.95, keySegmentAgreement: 0.6 })).toBe(false);
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.95, keySegmentAgreement: 0.95, harmonicFeatures: { status: "insufficient_evidence" } })).toBe(false);
    expect(isReliableKey({ key: null, mode: null, keyConfidence: 0.99, keySegmentAgreement: 1 })).toBe(false);
  });

  it("removes taxonomy genre claims from free text when provider classification abstains", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      bpm: 120,
      tempoConfidence: 0.82,
      genreClassification: { primaryGenre: null, abstained: true },
    });
    expect(JSON.stringify(result)).not.toMatch(/Afrobeats|Afro Soul/i);
    expect(result.aAndRPositioning.primaryLane).toContain("Unconfirmed");
  });

  it("forces marketability to undetermined without verified source-attributed commercial metrics", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      genreClassification: { primaryGenre: "Afrobeats", abstained: false },
    });
    expect(result.commercialRead.marketability).toBe("undetermined");
    expect(result.commercialRead.rationale).toContain("No verified, source-attributed commercial-performance metrics");
  });

  it("nulls tempo-derived scores and removes unsupported tempo claims when confidence is zero", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      provenance: "uploaded_audio_master",
      bpm: 156,
      tempoConfidence: 0,
      rhythmFeatures: { status: "measured" },
      genreClassification: { primaryGenre: null, abstained: true },
    });
    expect(result.scorecard.tempoLaneFit.score).toBeNull();
    expect(result.scorecard.rhythmicConsistency.score).toBeNull();
    expect(result.risks).toContain("Tempo and groove consistency require review.");
    expect(JSON.stringify(result)).not.toMatch(/156\s*BPM|high-energy|fast tempo|tempo confirms/i);
    expect(result.aAndRPositioning.primaryLane).toContain("Unconfirmed");
    expect(result.aAndRPositioning.adjacentLanes).toEqual([]);
  });

  it("preserves tempo and lane claims when tempo confidence and provider genre evidence are adequate", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      provenance: "uploaded_audio_master",
      bpm: 120,
      tempoConfidence: 0.82,
      genreClassification: { primaryGenre: "Afrobeats", abstained: false },
    });
    expect(result.scorecard.tempoLaneFit.score).toBe(80);
    expect(result.aAndRPositioning.primaryLane).toBe("Afrobeats");
  });
});
