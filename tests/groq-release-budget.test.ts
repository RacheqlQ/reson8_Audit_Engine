import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

const long = (text: string, minimum = 65): string => {
  const words = text.split(/\\s+/);
  return Array.from({ length: minimum }, (_, index) => words[index % words.length]).join(" ");
};

function section(group: string): Record<string, unknown> {
  const rationale = long("The supplied evidence supports this limited assessment while important source limitations remain and require verification before any external decision.");
  switch (group) {
    case "narrative":
      return {
        assessmentVersion: "3.0",
        executiveSummary: long("This assessment separates supplied track evidence from interpretation and general industry practice. No unsupported audience or commercial claims are made."),
        creativeIdentity: long("This creative identity description is a provisional interpretation of the supplied evidence and requires full listening review before external use."),
        strengths: [long("The source record provides a traceable identity field for this assessment."), long("The supplied evidence supports a limited and clearly bounded analysis."), long("The assessment records the outstanding verification requirements.")],
        risks: [long("No verified audience telemetry is present to establish demand or conversion."), long("Rights and release readiness require independent source verification.")],
      };
    case "positioning":
      return { aAndRPositioning: { primaryLane: "R&B", adjacentLanes: ["Alternative R&B"], rationale }, commercialRead: { marketability: "undetermined", rationale } };
    case "release":
      return { releaseStrategy: { recommendation: rationale, priorities: [long("Verify master and release identity fields against authoritative source records."), long("Complete a human listening review and document time-coded observations."), long("Collect platform-native performance data before making commercial claims.")] } };
    case "evidence-score":
      return {
        evidenceGaps: [long("No verified audience telemetry or conversion evidence was supplied.")],
        confidence: 0.5,
        limitations: [long("The assessment is limited to the evidence fields supplied for this request.")],
        scorecard: Object.fromEntries(["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"].map(key => [key, { score: null, rationale }])),
        humanListeningChecklist: [long("Does the opening create a clear reason to continue listening?", 8), long("Can the hook be recalled after one play and which phrase carries it?", 8), long("Does the vocal delivery communicate a distinctive point of view?", 8), long("What feels genuinely original against verified references and which details should be checked?", 8), long("Does the arrangement create development and payoff without excess repetition?", 8)],
        evidenceLabels: [{ label: "OBSERVED", claim: long("Measured acoustic values are supplied by the uploaded master and retain their measurement provenance."), source: "uploaded_audio_master" }],
      };
    case "production":
      return { productionArrangementGuidance: rationale, industryPractice: rationale, listeningChecks: [long("Check the opening and section transitions against the complete approved master."), long("Review vocal and instrumental balance across dense and sparse sections."), long("Check low-end translation and the ending on multiple playback systems."), long("Record any production observation with a time-coded reference.")] };
    case "comparables":
      return { laneHypothesis: rationale, referencesToVerify: [long("Search verified releases for similar arrangement and vocal treatment."), long("Compare tempo feel and sound palette using full recordings."), long("Verify release identity and context before naming a reference.")], verificationMethod: rationale };
    case "promotion":
      return { promotionPlan: { preRelease: rationale, releaseWindow: rationale, postRelease: rationale, contentIdeas: [long("Create an approved performance excerpt."), long("Prepare a verified artist-story clip."), long("Develop a rights-cleared production breakdown."), long("Test an approved visual motif.")], pitchingAngles: [long("Lead with the verified musical feature that distinguishes the approved recording."), long("Connect the artist story to a specific and source-checked release reason."), long("Frame the track for a relevant lane category without implying acceptance.")], playlistCategories: [long("Lane-specific R&B discovery", 4), long("Alternative R&B programming", 4), long("Mood-led independent discovery", 4)], industryPractice: rationale } };
    case "label-fit":
      return { labelPartnerFit: { partnerProfile: rationale, criteriaToDemonstrate: [long("Demonstrate a clear artist proposition with approved recordings."), long("Provide complete rights and credits information."), long("Show a consistent creative direction."), long("Document a credible release plan and responsibilities.")], diligenceBeforeContact: rationale, industryPractice: rationale } };
    default:
      return { executionPlan: { days30: rationale, days60: rationale, days90: rationale } };
  }
}

const groups = ["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"];

describe("Groq release prompt budget regression", () => {
  it("fits a production-sized uploaded-master Sonic DNA payload under the shared cap without losing measured descriptor values", async () => {
    const descriptorEntries = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ["descriptor" + index, {
      median: index + 0.125,
      p10: index - 0.25,
      p90: index + 0.875,
      unit: "measured_unit_" + index,
      method: "windowed_fft_descriptor_" + index,
    }]));
    const predictions = {
      mood: { status: "provisional", labels: ["warm", "reflective"], scores: { bright: 40, dark: 60, driving: 55, calm: 45, tense: 30, warm: 72 }, method: "audio_feature_heuristics_v1", probability: null },
      energy: { status: "provisional", label: "moderate", score: 62, method: "audio_feature_heuristics_v1", probability: null },
    };
    const sonicDna = {
      provenance: "uploaded_audio_master",
      evidenceClass: "OBSERVED",
      analysisVersion: "fixture-v1",
      sourceProviders: ["first_party_audio_analysis"],
      confidence: 0.91,
      bpm: 96,
      tempoConfidence: 0.92,
      key: "A minor",
      mode: "minor",
      moodTags: ["warm", "reflective"],
      genreTags: ["R&B"],
      limitations: ["Predicted classifications remain provisional and are not evidence of audience demand."],
      acousticFeatureProfile: {
        status: "analyzed",
        provenance: { featureVersion: "fixture-v1", algorithm: "first_party", windowCount: 128, aggregation: "median_p10_p90" },
        descriptors: descriptorEntries,
        windowSummaries: Array.from({ length: 128 }, (_, index) => ({ startSeconds: index, endSeconds: index + 1, rmsDbfs: -20 + index / 100, spectralCentroidHz: 1800 + index, spectralFlatness: 0.2 })),
        predictions,
        abstentionReasons: [],
      },
      rhythmFeatures: {
        status: "measured", method: "windowed", bpm: 96, confidence: 0.92,
        beatTimesSeconds: Array.from({ length: 128 }, (_, index) => index * 0.625),
        onsetEnvelope: Array.from({ length: 128 }, (_, index) => index / 128),
      },
      harmonicFeatures: {
        status: "measured", key: "A minor", confidence: 0.88,
        segmentChroma: Array.from({ length: 128 }, () => Array.from({ length: 12 }, (_, index) => index / 12)),
      },
    };
    const requests: Array<{ group: string; body: Record<string, any>; payload: Record<string, any> }> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      requests.push({ group: payload.sectionGroup, body, payload });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(section(payload.sectionGroup)) } }],
        usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000 },
      }), { status: 200 });
    });

    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: { auditType: "MASTER-BASED AUDIT", artist: "Budget Fixture", title: "Long Evidence Track" }, sonicDna });

    expect(result.assessmentVersion).toBe("3.0");
    expect(requests.map(request => request.group).sort()).toEqual([...groups].sort());
    const release = requests.find(request => request.group === "release");
    expect(release).toBeDefined();
    for (const request of requests) {
      const serialized = new TextEncoder().encode(JSON.stringify({
        messages: request.body.messages,
        response_format: request.body.response_format,
      })).length;
      const enforcedInput = Math.ceil(serialized / 2) + 256;
      expect(enforcedInput + request.body.max_completion_tokens).toBeLessThanOrEqual(6000);
      expect(request.body.response_format.type).toBe("json_schema");
    }
    expect(release?.payload.sonicDna).toMatchObject({
      provenance: "uploaded_audio_master",
      evidenceClass: "OBSERVED",
      confidence: 0.91,
      bpm: 96,
      tempoConfidence: 0.92,
      key: "A minor",
      acousticFeatureProfile: { status: "analyzed" },
    });
    expect(release?.payload.sonicDna).not.toHaveProperty("rhythmFeatures");
    expect(release?.payload.sonicDna).not.toHaveProperty("harmonicFeatures");
    expect(release?.payload.sonicDna.acousticFeatureProfile).not.toHaveProperty("windowSummaries");
    expect(release?.payload.sonicDna.acousticFeatureProfile.predictions).toMatchObject({
      mood: { status: "provisional", labels: ["warm", "reflective"] },
      energy: { status: "provisional", label: "moderate", score: 62 },
    });
    const releaseDescriptors = release?.payload.sonicDna.acousticFeatureProfile.descriptors;
    expect(Object.keys(releaseDescriptors ?? {})).toHaveLength(12);
    expect(releaseDescriptors?.descriptor11).toEqual({ median: 11.125, p10: 10.75, p90: 11.875, unit: "measured_unit_11", method: "windowed_fft_descriptor_11" });
    const evidenceScore = requests.find(request => request.group === "evidence-score");
    expect(evidenceScore?.payload.sonicDna).toHaveProperty("rhythmFeatures");
    expect(evidenceScore?.payload.sonicDna).toHaveProperty("harmonicFeatures");
  });
});
