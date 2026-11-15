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
  labelPartnerFit: {
    partnerProfile: "An instrumental-focused boutique label is a strong fit for this recording.",
    criteriaToDemonstrate: ["Demonstrate instrumental production quality and playlist fit."],
    diligenceBeforeContact: "Prepare an instrumental pitch for the label.",
  },
  executionPlan: {
    days30: "Prepare the instrumental campaign and pitch to suitable labels.",
    days60: "Release the instrumental edit and begin playlist outreach.",
    days90: "Scale the campaign based on playlist response.",
  },
  productionArrangementGuidance: "Add a new instrumental bridge and strengthen the bass arrangement.",
  confidence: 0,
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

  it("reconciles present-but-conflicting album metadata instead of calling it missing", () => {
    const assessment = {
      ...baseAssessment,
      evidenceGaps: ["Album title is missing from the release metadata."],
      limitations: ["The album field is unavailable."],
      risks: ["The album is missing and identity context is incomplete."],
      scorecard: {
        ...baseAssessment.scorecard,
        metadataCompleteness: { score: 35, rationale: "Album title is missing from all available metadata sources." },
      },
    };
    const result = sanitizeAssessmentForEvidence(assessment, null, {
      album: "Hole-Hearted",
      reconciliation: { conflicts: [{ field: "album", values: ["Hole-Hearted - EP", "Hole-Hearted"] }] },
    });
    expect(result.scorecard.metadataCompleteness.score).toBeNull();
    expect(result.scorecard.metadataCompleteness.rationale).toContain("present but conflicting");
    expect(result.evidenceGaps.join(" ")).toContain("Album metadata is present but conflicting");
    expect(JSON.stringify(result)).not.toMatch(/album (?:title )?(?:is )?(?:missing|unavailable)/i);
  });

  it("retains a model marketability verdict only when verified source-attributed metrics and a reporting period exist", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      genreClassification: { primaryGenre: "Afrobeats", abstained: false },
    }, {
      commercialEvidence: {
        verified: true,
        source: "Spotify for Artists",
        reportingPeriod: "2026-10",
        streams: 1200,
      },
    });
    expect(result.commercialRead.marketability).toBe("high");
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

  it("does not assert instrumental or vocal absence when vocal analysis was not performed", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "This is an instrumental track with no vocals, although vocal analysis was not performed.",
      releaseStrategy: { recommendation: "Without vocal content, target instrumental playlists.", priorities: ["Pitch to instrumental playlists."] },
      promotionPlan: { pitchingAngles: ["Promote this vocal-free instrumental beat."], playlistCategories: ["Instrumental lo-fi playlists"] },
      evidenceGaps: ["Vocal analysis was not performed because no vocal-activity model is configured."],
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      vocalFeatures: { status: "not_analyzed", reason: "No vocal analysis model is configured." },
    });
    expect(JSON.stringify(result)).not.toMatch(/instrumental|vocal-free|no vocals|without vocal content/i);
    expect(JSON.stringify(result)).toContain("Vocal analysis was not performed");
  });

  it("withholds track-specific release and partner recommendations when overall assessment confidence is zero", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      provenance: "uploaded_audio_master",
      bpm: 95,
      tempoConfidence: 0,
      vocalFeatures: { status: "not_analyzed" },
      genreClassification: { primaryGenre: null, abstained: true },
    });
    expect(result.releaseStrategy.recommendation).toContain("No track-specific release recommendation is issued");
    expect(result.labelPartnerFit.partnerProfile).toContain("No label or partner fit can be established");
    expect(result.executionPlan.days30).toContain("Verify artist, title and release identity");
    expect(result.productionArrangementGuidance).toContain("No track-specific production changes are recommended");
  });
  it("withholds every numeric score when overall assessment confidence is zero", () => {
    const assessment = {
      ...baseAssessment,
      confidence: 0,
      scorecard: {
        ...baseAssessment.scorecard,
        dynamicRangeLoudness: { score: 78, rationale: "A populated test score that must be withheld when the overall assessment has zero confidence." },
        metadataCompleteness: { score: 65, rationale: "A populated test score that must be withheld when the overall assessment has zero confidence." },
        releaseReadiness: { score: 72, rationale: "A populated test score that must be withheld when the overall assessment has zero confidence." },
      },
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      bpm: 95,
      tempoConfidence: 0,
      vocalFeatures: { status: "not_analyzed" },
      genreClassification: { primaryGenre: null, abstained: true },
    });
    expect(Object.values(result.scorecard).every((dimension) => dimension.score === null)).toBe(true);
    expect(Object.values(result.scorecard).every((dimension) => /overall assessment confidence is zero/i.test(dimension.rationale))).toBe(true);
  });

});
