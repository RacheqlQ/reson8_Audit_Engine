import { describe, expect, it } from "vitest";
import { isReliableKey, isReliableTempo, hasMultipleTuningWindows, sanitizeAssessmentForEvidence } from "../src/reports/evidence-guardrails.js";
import { buildTempoDiagnosticLines } from "../src/reports/v2/render.js";

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
  confidence: 0.75,
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

  it("uses the same tempo acceptance floor as the detector", () => {
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.5 })).toBe(true);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.499 })).toBe(false);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.9, abstentionReason: "ambiguous pulse" })).toBe(false);
    expect(isReliableTempo({ bpm: 120, tempoConfidence: 0.9, rhythmFeatures: { status: "measured", abstentionReason: "ambiguous pulse" } })).toBe(false);
    expect(isReliableTempo({ bpm: 0, tempoConfidence: 0.9 })).toBe(false);
    expect(isReliableTempo({ bpm: null, tempoConfidence: 0.9 })).toBe(false);
  });

  it("accepts only 40–220 BPM as a reportable tempo measurement", () => {
    expect(isReliableTempo({ bpm: 40, tempoConfidence: 0.9 })).toBe(true);
    expect(isReliableTempo({ bpm: 220, tempoConfidence: 0.9 })).toBe(true);
    expect(isReliableTempo({ bpm: 39.99, tempoConfidence: 0.9 })).toBe(false);
    expect(isReliableTempo({ bpm: 220.01, tempoConfidence: 0.9 })).toBe(false);
  });

  it("removes mismatched numeric tempo and loudness claims across assessment sections", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "The uploaded master measures 156 BPM. Integrated loudness is -14.0 LUFS.",
      creativeIdentity: "The measured tempo is 120 BPM and integrated loudness is -11.3 LUFS.",
      strengths: ["The track measures 156 BPM."],
      risks: ["The loudness is -14.0 LUFS."],
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      bpm: 120,
      tempoConfidence: 0.94,
      loudnessLufs: -11.32,
      loudnessRangeLu: 7.4,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("156 BPM");
    expect(serialized).not.toContain("-14.0 LUFS");
    expect(result.creativeIdentity).toContain("120 BPM");
    expect(result.creativeIdentity).toContain("-11.3 LUFS");
  });

  it("filters out-of-range tempo candidates from every diagnostic estimate", () => {
    const lines = buildTempoDiagnosticLines({
      sonicDna: { rhythmFeatures: {
        candidateScores: [{ bpm: 39, score: 0.9 }, { bpm: 40, score: 0.8 }, { bpm: 220, score: 0.7 }, { bpm: 221, score: 0.6 }],
        candidateBpms: [39, 40, 220, 221],
        alternateTempo: 240,
        independentEstimator: { bpm: 250, score: 0.5 },
        confidence: 0.8,
        beatGridStatus: "tentative",
      } },
    } as any).join(" ");

    expect(lines).toContain("Possible tempo readings: 40 BPM; 220 BPM.");
    expect(lines).not.toMatch(/score|confidence|probability|detector/i);
    expect(lines).not.toContain("39 BPM");
    expect(lines).not.toContain("221 BPM");
    expect(lines).not.toContain("Alternate half/double-time candidate");
    expect(lines).not.toContain("Independent low-frequency envelope estimate");
  });

  it("does not mislabel a missing genre tempo range as a failed tempo-confidence gate", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      bpm: 96,
      tempoConfidence: 0.94,
      genreClassification: { primaryGenre: null, abstained: true },
    });
    expect(result.scorecard.tempoLaneFit.score).toBeNull();
    expect(result.scorecard.tempoLaneFit.rationale).toContain("tempo remains provisional");
    expect(result.scorecard.tempoLaneFit.rationale).not.toContain("did not pass the confidence gate");
  });

  it("enforces the approved key reportability floors while retaining lower provisional candidates", () => {
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.8, keySegmentAgreement: 0.8 })).toBe(true);
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.799, keySegmentAgreement: 0.95 })).toBe(false);
    expect(isReliableKey({ key: "C", mode: "major", keyConfidence: 0.95, keySegmentAgreement: 0.799 })).toBe(false);
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
    expect(result.commercialRead.rationale).toContain("ISRC-linked catalogue evidence");
    expect(result.commercialRead.rationale).toContain("verified DSP analytics for a defined reporting period");
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
    expect(result.scorecard.metadataCompleteness.rationale).toContain("album conflict is documented");
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

  it("blocks loudness optimisation claims near -11 LUFS and brightness claims below 2 kHz", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "The master measures -11 LUFS and needs loudness optimisation. The 1.9 kHz spectral centroid makes the recording bright.",
      productionArrangementGuidance: "Increase loudness to reach a louder target and make the low-mid spectrum brighter.",
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      loudnessLufs: -11,
      spectralCentroidHz: 1900,
      channels: 2,
      genreClassification: { primaryGenre: "Pop", abstained: false, genres: [{ label: "Pop" }] },
    });
    expect(JSON.stringify(result)).not.toMatch(/loudness optimisation|increase loudness|1\.9 kHz.*bright|makes the recording bright|spectrum brighter/i);
  });

  it("flags a mono master as a delivery compatibility risk", () => {
    const result = sanitizeAssessmentForEvidence(baseAssessment, {
      provenance: "uploaded_audio_master",
      channels: 1,
      genreClassification: { primaryGenre: "Pop", abstained: false, genres: [{ label: "Pop" }] },
    });
    expect(result.risks.join(" ")).toMatch(/Mono master delivery risk/i);
  });

  it("restricts freeform A&R genre labels to taxonomy-backed labels", () => {
    const assessment = {
      ...baseAssessment,
      aAndRPositioning: { primaryLane: "Afro-pop Fusion", adjacentLanes: ["Afro Soul"], rationale: "A provisional lane." },
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      genreClassification: { primaryGenre: "Pop", abstained: false, genres: [{ label: "Pop" }] },
    });
    expect(result.aAndRPositioning.primaryLane).toBe("Pop");
    expect(result.aAndRPositioning.adjacentLanes).toEqual(["R&B", "Hip-Hop", "House"]);
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
    expect(result.risks).not.toContain("Tempo and groove consistency require review.");
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
    expect(result.scorecard.tempoLaneFit.score).toBe(100);
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
    const result = sanitizeAssessmentForEvidence({ ...baseAssessment, confidence: 0 }, {
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
  it("withholds creative positioning and inferred evidence when overall confidence is zero even if individual signals are reliable", () => {
    const assessment = {
      ...baseAssessment,
      confidence: 0,
      creativeIdentity: "A reliable tempo and provider genre establish a definitive Afrobeats identity.",
      strengths: ["The track has a strong Afrobeats identity and a clear audience lane."],
      evidenceLabels: [{ label: "INFERRED", claim: "This track is Afrobeats.", source: "groq_assessment" }],
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      bpm: 120,
      tempoConfidence: 0.95,
      rhythmFeatures: { status: "measured" },
      genreClassification: { primaryGenre: "Afrobeats", abstained: false },
    });
    expect(result.creativeIdentity).toContain("Creative identity is unconfirmed");
    expect(result.strengths.join(" ")).not.toMatch(/Afrobeats|strong audience lane/i);
    expect(JSON.stringify(result.evidenceLabels)).not.toContain("This track is Afrobeats");
    expect(result.aAndRPositioning.primaryLane).toContain("Unconfirmed");
  });

  it("does not use key confidence as a rationale for an unmeasured dynamic-range dimension", () => {
    const assessment = {
      ...baseAssessment,
      confidence: 0.75,
      scorecard: {
        ...baseAssessment.scorecard,
        dynamicRangeLoudness: {
          score: 74,
          rationale: "Key confidence is low in this partial fixture; this null score is intentional.",
        },
      },
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      keyConfidence: 0.06,
      dynamicRangeDb: null,
      loudnessLufs: null,
      rmsLevelDbfs: null,
    });
    expect(result.scorecard.dynamicRangeLoudness.score).toBeNull();
    expect(result.scorecard.dynamicRangeLoudness.rationale).toContain("destination-specific integrated-loudness");
    expect(result.scorecard.dynamicRangeLoudness.rationale).not.toContain("Key confidence");
  });

  it("keeps RMS-envelope technical readiness unscored without destination-specific delivery targets", () => {
    const assessment = {
      ...baseAssessment,
      scorecard: {
        ...baseAssessment.scorecard,
        dynamicRangeLoudness: { score: 78, rationale: "A model-generated technical readiness score." },
      },
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      dynamicRangeDb: 22.36,
      loudnessLufs: -15.1,
      loudnessRangeLu: 10.8,
      truePeakDbfs: -2.3,
      rmsLevelDbfs: -20.3,
    });
    expect(result.scorecard.dynamicRangeLoudness.score).toBeNull();
    expect(result.scorecard.dynamicRangeLoudness.rationale).toContain("destination-specific integrated-loudness");
    expect(result.scorecard.dynamicRangeLoudness.rationale).not.toContain("model-generated");
  });

  it("withholds every numeric score when overall assessment confidence is zero", () => {
    const assessment = {
      ...baseAssessment,
      confidence: 0,
      scorecard: {
        ...baseAssessment.scorecard,
        dynamicRangeLoudness: { score: 78, rationale: "Key confidence is low; this does not justify a dynamic-range score." },
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
    expect(Object.values(result.scorecard).every((dimension) => /^Not scored:/i.test(dimension.rationale))).toBe(true);
    expect(result.scorecard.dynamicRangeLoudness.rationale).not.toContain("Key confidence");
    expect(result.scorecard.dynamicRangeLoudness.rationale).toContain("No destination-specific loudness or peak targets were supplied");
  });

  it("removes specific key and mode assertions from narrative when key confidence is below the reporting gate", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "The recording is in F-sharp major with a confident tonal center.",
      creativeIdentity: "F# major gives the track a resolved, uplifting harmonic identity.",
      strengths: ["The F-sharp major key creates a memorable harmonic color."],
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      key: "F#",
      mode: "major",
      keyConfidence: 0.049,
      keySegmentAgreement: 0.5,
      harmonicFeatures: { status: "insufficient_evidence" },
    });
    expect(JSON.stringify(result)).not.toMatch(/F-sharp major|F# major|tonal center|harmonic identity/i);
  });

  it("withholds low-confidence tempo/key and unperformed-vocal claims from the evidence ledger", () => {
    const assessment = {
      ...baseAssessment,
      evidenceLabels: [
        { label: "OBSERVED", claim: "Tempo estimate: 95 BPM.", source: "uploaded_audio_master" },
        { label: "OBSERVED", claim: "Key and mode: F-sharp major.", source: "uploaded_audio_master" },
        { label: "OBSERVED", claim: "Vocal analysis confirms an instrumental recording.", source: "uploaded_audio_master" },
        { label: "OBSERVED", claim: "RMS loudness level: -11.32 dBFS.", source: "uploaded_audio_master" },
        { label: "OBSERVED", claim: "Measured dynamic range: 13.11 dB.", source: "uploaded_audio_master" },
      ],
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      bpm: 95,
      tempoConfidence: 0,
      key: "F#",
      mode: "major",
      keyConfidence: 0.049,
      keySegmentAgreement: 0.5,
      rmsLevelDbfs: -11.32,
      dynamicRangeDb: 13.11,
      vocalFeatures: { status: "not_analyzed" },
    });
    const claims = result.evidenceLabels.map((entry) => entry.claim).join(" ");
    expect(claims).not.toMatch(/tempo|BPM|key and mode|major|vocal|instrumental/i);
    expect(claims).toContain("RMS loudness level: -11.32 dBFS");
    expect(claims).toContain("Measured RMS-envelope spread (internal proxy; not mastering dynamic range): 13.11 dB");
  });


  it("withholds unsupported numeric claims for duration, sample rate, channels and acoustic descriptors", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "Duration is 180 seconds. Sample rate is 48000 Hz. The master has 2 channels. RMS energy is 0.42 and zero-crossing rate is 0.125.",
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master", durationSeconds: 179.5, sampleRate: 44100, channels: 1,
      rmsEnergy: 0.31, zeroCrossingRate: 0.09,
    });
    expect(result.executiveSummary).not.toMatch(/180 seconds|48000 Hz|2 channels|0.42|0.125/);
  });

  it("retains rounded numeric acoustic claims only when they match the uploaded-master measurement", () => {
    const assessment = {
      ...baseAssessment,
      executiveSummary: "Duration is 179.5 seconds. Sample rate is 44100 Hz. The master has 1 channel. RMS energy is 0.31 and zero-crossing rate is 0.09.",
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master", durationSeconds: 179.5, sampleRate: 44100, channels: 1,
      rmsEnergy: 0.31, zeroCrossingRate: 0.09,
    });
    expect(result.executiveSummary).toContain("179.5 seconds");
    expect(result.executiveSummary).toContain("44100 Hz");
    expect(result.executiveSummary).toContain("1 channel");
    expect(result.executiveSummary).toContain("0.31");
    expect(result.executiveSummary).toContain("0.09");
  });

  it("fills all five scorecard dimensions when a zero-confidence assessment is incomplete", () => {
    const assessment = {
      ...baseAssessment,
      confidence: 0,
      scorecard: {
        tempoLaneFit: { score: 88, rationale: "Unsupported populated fixture score." },
      },
    };
    const result = sanitizeAssessmentForEvidence(assessment, {
      provenance: "uploaded_audio_master",
      bpm: 95,
      tempoConfidence: 0,
      vocalFeatures: { status: "not_analyzed" },
    });
    const required = [
      "tempoLaneFit",
      "rhythmicConsistency",
      "dynamicRangeLoudness",
      "metadataCompleteness",
      "releaseReadiness",
    ];
    expect(Object.keys(result.scorecard).sort()).toEqual(required.sort());
    expect(Object.values(result.scorecard).every((dimension) => dimension.score === null)).toBe(true);
    expect(Object.values(result.scorecard).every((dimension) => /^Not scored:/i.test(dimension.rationale))).toBe(true);
    expect(result.strengths).toEqual([]);
  });

});
 
describe("deterministic evidence scorecard",()=>{
 it("scores source-backed metadata completeness and discounts conflicting identity fields",()=>{
  const result=sanitizeAssessmentForEvidence(baseAssessment,{
   provenance:"uploaded_audio_master",bpm:165,tempoConfidence:0.08,key:"C",mode:"major",keyConfidence:0.12,keySegmentAgreement:0.5,
   rhythmFeatures:{beatGridStatus:"tentative",beatTimesSeconds:Array.from({length:32},(_,index)=>index*0.36)},
   genreClassification:{primaryGenre:"Pop",abstained:false,genres:[{id:"pop",label:"Pop",confidence:0.9,sources:["apple_music"]}],adjacentLanes:["R&B","Hip-Hop","House"]},
  },{
   artist:"Artist",title:"Track",album:"Album",isrc:"USABC1234567",label:"Label",releaseDate:"2025-01-01",genre:"Pop",
   fieldProvenance:{artist:"tidal",title:"apple_music",album:"tidal",isrc:"musicbrainz",label:"tidal",releaseDate:"apple_music",genre:"apple_music"},
   reconciliation:{conflicts:[{field:"artist",values:["Artist","Artist & Orchestra"]},{field:"title",values:["Track","Track (Video)"]}]},
  });
  expect(result.scorecard.metadataCompleteness.score).toBe(75);
  expect(result.scorecard.tempoLaneFit.score).toBeNull();
  expect(result.scorecard.rhythmicConsistency.score).toBeNull();
  expect(result.scorecard.releaseReadiness.score).toBeNull();
  expect(result.scorecard.tempoLaneFit.rationale).not.toBe(result.scorecard.rhythmicConsistency.rationale);
 });
});


describe("independent tuning reliability", () => {
  it("accepts a measured tuning offset even when key confidence is unresolved", () => {
    expect(hasMultipleTuningWindows({ key: null, mode: null, keyConfidence: 0.12, keyTuningCents: 18, tuningEvidenceWindows: 3 })).toBe(true);
  });

  it("rejects tuning offsets without multiple supporting tonal windows", () => {
    expect(hasMultipleTuningWindows({ keyTuningCents: 18, tuningEvidenceWindows: 1 })).toBe(false);
    expect(hasMultipleTuningWindows({ keyTuningCents: null, tuningEvidenceWindows: 4 })).toBe(false);
    expect(hasMultipleTuningWindows({ keyTuningCents: 62, tuningEvidenceWindows: 4 })).toBe(false);
  });
});


describe("Circle of Fifths reportability contract", () => {
  const confirmedResolution = {
    status: "CONFIRMED", tonic: "C", mode: "major", reasonCodes: [],
    candidates: [{ tonic: "C", pitchClass: 0, mode: "major", score: 0.5, bootstrapShare: 0.9, windowAgreement: 0.75, margin: 0.08 }],
    bootstrapShare: 0.9, windowAgreement: 0.75, runnerUpMargin: 0.08,
    validWindowCount: 8, meanSalience: 0.6, method: "circle_of_fifths_audio_first_v1",
    thresholds: { minWindows: 3, minMeanSalience: 0.12, minBootstrapShare: 0.8, minWindowAgreement: 0.7, minRunnerUpMargin: 0.025 },
  } as const;

  it("honours a confirmed tonal resolution without reapplying the legacy 0.80 agreement gate", () => {
    expect(isReliableKey({
      key: "C", mode: "major", keyConfidence: 0.42, keySegmentAgreement: 0.75,
      tonalResolution: confirmedResolution,
    })).toBe(true);
  });

  it("does not let a confirmed status override a mismatched tonic or mode", () => {
    expect(isReliableKey({
      key: "D", mode: "major", keyConfidence: 0.99, keySegmentAgreement: 0.99,
      tonalResolution: confirmedResolution,
    })).toBe(false);
    expect(isReliableKey({
      key: "C", mode: "minor", keyConfidence: 0.99, keySegmentAgreement: 0.99,
      tonalResolution: confirmedResolution,
    })).toBe(false);
  });

  it("keeps provisional tonal resolutions out of the confirmed key field", () => {
    expect(isReliableKey({
      key: "C", mode: "major", keyConfidence: 0.99, keySegmentAgreement: 0.99,
      tonalResolution: { ...confirmedResolution, status: "PROVISIONAL" },
    })).toBe(false);
  });
});
