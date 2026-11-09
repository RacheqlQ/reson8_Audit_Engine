import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, GroqClient } from "../src/providers/groq/client.js";

describe("GroqClient", () => {
  it("uses the standardized model when GROQ_MODEL is not configured", async () => {
    const previous = process.env.GROQ_MODEL;
    delete process.env.GROQ_MODEL;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }]
    }), { status: 200 }));
    try {
      const client = new GroqClient("test-key", undefined, fetchMock as typeof fetch);
      await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow();
      const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
      expect(body.model).toBe(DEFAULT_GROQ_MODEL);
      expect(body.model).toBe("openai/gpt-oss-120b");
    } finally {
      if (previous === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = previous;
    }
  });

  it("parses a strict JSON A&R assessment from Groq", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            assessmentVersion: "1.0",
            executiveSummary: "Strong rhythmic identity with a clear low-energy R&B lane.",
            creativeIdentity: "Introspective, groove-led R&B with a dark tonal profile.",
            strengths: ["Rhythmic identity", "Controlled energy"],
            risks: ["Limited evidence for market performance"],
            aAndRPositioning: {
              primaryLane: "Afro-R&B",
              adjacentLanes: ["Alternative R&B"],
              rationale: "The observed Sonic DNA supports the lane."
            },
            commercialRead: {
              marketability: "undetermined",
              rationale: "No market-performance evidence was supplied."
            },
            releaseStrategy: {
              recommendation: "Position around the song's strongest sonic identity.",
              priorities: ["Lead with the strongest hook", "Validate audience response"]
            },
            evidenceGaps: ["No audience telemetry supplied"],
            confidence: 0.82,
            limitations: ["Assessment is limited to supplied evidence."]
          })
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch);
    const result = await client.assess({
      evidence: {
        status: "verified",
        artist: "Artist",
        title: "Song",
        isrc: "NGABC2600001",
        sources: ["audd", "spotify"]
      },
      sonicDna: {
        bpm: 94,
        key: null,
        mode: null,
        loudnessLufs: -12.4,
        rmsEnergy: 0.08,
        dynamicRangeDb: 9.2,
        spectralCentroidHz: 1800,
        spectralBandwidthHz: 0,
        spectralRolloffHz: 0,
        zeroCrossingRate: 0.04,
        moodTags: ["Low Energy"],
        genreContext: ["R&B", "Afrobeats"]
      }
    });

    expect(result.assessmentVersion).toBe("1.0");
    expect(result.confidence).toBe(0.82);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
    expect(body.model).toBe("test-model");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("ar_assessment");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.assessmentVersion).toBeDefined();
    expect(body.response_format.json_schema.schema.required).toContain("executiveSummary");
  });

  it("rejects non-JSON or schema-invalid model output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }]
    }), { status: 200 }));

    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch);

    await expect(client.assess({
      evidence: { status: "unresolved", sources: [] },
      sonicDna: null
    })).rejects.toThrow();
  });
});
