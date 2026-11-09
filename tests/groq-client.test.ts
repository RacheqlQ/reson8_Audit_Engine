import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, GroqClient } from "../src/providers/groq/client.js";

const groupPayloads = {
  narrative: {
    assessmentVersion: "2.0",
    executiveSummary: "The supplied evidence describes a rhythm-led recording with a coherent identity, while leaving audience and market performance unverified. The assessment separates measurable audio traits from interpretive positioning.",
    creativeIdentity: "The recording presents a restrained, groove-led identity. This is an interpretation of the supplied sonic profile rather than a claim about audience response or commercial performance.",
    strengths: [
      "The supplied tempo measurement gives the arrangement a concrete rhythmic reference.",
      "The audio profile provides measurable production characteristics for comparison.",
      "The reconciled identity fields provide a usable basis for track-level positioning."
    ],
    risks: [
      "No verified audience telemetry is included, so demand and reach cannot be established.",
      "The available evidence does not establish playlist conversion, revenue, or listener retention."
    ]
  },
  positioning: {
    aAndRPositioning: {
      primaryLane: "Afro-R&B",
      adjacentLanes: ["Alternative R&B"],
      rationale: "This positioning is an inferred creative lane based on the supplied tempo, mood tags, and genre context. It should be treated as a discovery hypothesis and validated against the complete recording and relevant audience response."
    },
    commercialRead: {
      marketability: "undetermined",
      rationale: "No verified streams, audience retention, sales, revenue, or playlist conversion data was supplied. Commercial marketability therefore cannot be scored as high, moderate, or low from this evidence set."
    }
  },
  release: {
    releaseStrategy: {
      recommendation: "Use the strongest verified sonic and identity signals to frame the release, then validate the positioning with real listener and campaign data before increasing spend or expanding the curator campaign.",
      priorities: [
        "Confirm the final artist, title, and release metadata against an authoritative source.",
        "Test the selected creative lane with a small, measurable audience cohort.",
        "Collect verified platform and campaign telemetry before making commercial claims."
      ]
    }
  },
  "evidence-score": {
    evidenceGaps: ["No verified audience telemetry or conversion history was supplied."],
    confidence: 0.72,
    limitations: ["The assessment is limited to the supplied audio and metadata evidence."],
    scorecard: {
      sonicIdentity: {
        score: 70,
        rationale: "The supplied audio measurements and mood tags provide a usable but incomplete sonic profile. The score reflects descriptive coverage, not artistic quality or predicted audience demand."
      },
      metadataIntegrity: {
        score: 65,
        rationale: "Some identity fields are present, but the evidence set does not independently corroborate every release and rights field. The score reflects the completeness of the supplied metadata only."
      },
      commercialEvidence: {
        score: null,
        rationale: "There is no verified audience, streaming, sales, revenue, or playlist-conversion evidence in the supplied payload. A numeric commercial score would imply unsupported certainty, so this dimension remains unscored."
      },
      releaseReadiness: {
        score: 55,
        rationale: "The supplied identity and sonic profile support preliminary planning, but audience validation and release metadata checks remain outstanding. The score reflects readiness of the evidence, not a guarantee of release performance."
      }
    },
    evidenceLabels: [
      {
        label: "OBSERVED",
        claim: "The supplied master analysis reports a tempo measurement for the recording.",
        source: "sonicDna.bpm"
      },
      {
        label: "RECONCILED",
        claim: "The artist and title fields are represented in the reconciled track identity.",
        source: "evidence.identity"
      },
      {
        label: "INFERRED",
        claim: "The proposed Afro-R&B lane is a creative interpretation, not a measured genre fact.",
        source: "sonicDna.genreContext"
      }
    ]
  }
};

function padToWords(input: string, minimum: number): string {
  const sentence = "This conclusion remains limited to the supplied evidence and requires independent listening and source validation before any commercial decision is made.";
  let output = input;
  while (output.trim().split(/\s+/).filter(Boolean).length < minimum) output += " " + sentence;
  return output;
}

groupPayloads.narrative.executiveSummary = padToWords(groupPayloads.narrative.executiveSummary, 45);
groupPayloads.narrative.creativeIdentity = padToWords(groupPayloads.narrative.creativeIdentity, 35);
groupPayloads.narrative.strengths = groupPayloads.narrative.strengths.map((item) => padToWords(item, 10));
groupPayloads.narrative.risks = groupPayloads.narrative.risks.map((item) => padToWords(item, 10));
groupPayloads.positioning.aAndRPositioning.rationale = padToWords(groupPayloads.positioning.aAndRPositioning.rationale, 40);
groupPayloads.positioning.commercialRead.rationale = padToWords(groupPayloads.positioning.commercialRead.rationale, 40);
groupPayloads.release.releaseStrategy.recommendation = padToWords(groupPayloads.release.releaseStrategy.recommendation, 40);
groupPayloads.release.releaseStrategy.priorities = groupPayloads.release.releaseStrategy.priorities.map((item) => padToWords(item, 8));
groupPayloads["evidence-score"].evidenceGaps = groupPayloads["evidence-score"].evidenceGaps.map((item) => padToWords(item, 8));
groupPayloads["evidence-score"].limitations = groupPayloads["evidence-score"].limitations.map((item) => padToWords(item, 8));
for (const score of Object.values(groupPayloads["evidence-score"].scorecard)) {
  score.rationale = padToWords(score.rationale, 25);
}
groupPayloads["evidence-score"].evidenceLabels = groupPayloads["evidence-score"].evidenceLabels.map((item) => ({
  ...item,
  claim: padToWords(item.claim, 8),
}));

function createFetchMock(invalidFirstGroup?: string) {
  const attempts = new Map<string, number>();
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const group = body.response_format.json_schema.name.replace(/^ar_/, "");
    const attempt = (attempts.get(group) ?? 0) + 1;
    attempts.set(group, attempt);
    const value = group === invalidFirstGroup && attempt === 1 ? {} : groupPayloads[group as keyof typeof groupPayloads];
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetchMock, attempts };
}

describe("GroqClient", () => {
  it("uses the standardized model and assembles four validated section groups", async () => {
    const previous = process.env.GROQ_MODEL;
    delete process.env.GROQ_MODEL;
    const { fetchMock } = createFetchMock();
    try {
      const client = new GroqClient("test-key", undefined, fetchMock as typeof fetch);
      const result = await client.assess({
        evidence: { status: "verified", artist: "Artist", title: "Song", identity: { artist: "Artist", title: "Song" } },
        sonicDna: { bpm: 94, key: null, mode: null, moodTags: ["Low Energy"], genreContext: ["R&B"] }
      });

      expect(result.assessmentVersion).toBe("2.0");
      expect(result.scorecard.commercialEvidence.score).toBeNull();
      expect(result.evidenceLabels.map((item) => item.label)).toContain("INFERRED");
      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const call of fetchMock.mock.calls) {
        const body = JSON.parse(String(call[1]?.body));
        expect(body.model).toBe(DEFAULT_GROQ_MODEL);
        expect(body.model).toBe("openai/gpt-oss-120b");
        expect(body.response_format.type).toBe("json_schema");
      }
    } finally {
      if (previous === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = previous;
    }
  });

  it("retries a section once when its Zod schema validation fails", async () => {
    const { fetchMock, attempts } = createFetchMock("narrative");
    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch);
    const result = await client.assess({ evidence: { artist: "Artist" }, sonicDna: null });

    expect(result.executiveSummary.length).toBeGreaterThanOrEqual(120);
    expect(attempts.get("narrative")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops after one retry when a section remains invalid", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const group = body.response_format.json_schema.name.replace(/^ar_/, "");
      const value = group === "narrative" ? {} : groupPayloads[group as keyof typeof groupPayloads];
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }]
      }), { status: 200 });
    });
    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch);

    await expect(client.assess({ evidence: {}, sonicDna: null }))
      .rejects.toThrow("failed Zod validation after one retry");
    expect(fetchMock.mock.calls.filter((call) => {
      const body = JSON.parse(String(call[1]?.body));
      return body.response_format.json_schema.name === "ar_narrative";
    })).toHaveLength(2);
  });
});
