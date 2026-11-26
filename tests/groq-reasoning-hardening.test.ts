import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

/**
 * HYPOTHESIS-BRANCH TESTS. These are unit tests with a MOCKED fetch. They do
 * NOT constitute a real-model reproduction. They verify only the local control
 * (reasoning_effort on GPT-OSS) and diagnostic capture (reasoning tokens),
 * using the response shapes Groq documents. No claim about job 1715b942 is made.
 */

const long = (s: string, n = 65) => { let v = s; while (v.trim().split(/\s+/).length < n) v += " " + s; return v; };
const rat = long("The supplied evidence supports this limited assessment while important source limitations remain and require verification before any external decision.");
function validSection(group: string): Record<string, unknown> {
  switch (group) {
    case "narrative": return { assessmentVersion: "3.0", executiveSummary: long("This assessment separates supplied track evidence from interpretation and general industry practice. No unsupported audience or commercial claims are made."), creativeIdentity: long("This creative identity description is a provisional interpretation of the supplied evidence and requires a full listening review."), strengths: [long("The source record provides a traceable identity field."), long("The supplied evidence supports a limited bounded analysis."), long("The assessment records outstanding verification requirements.")], risks: [long("No verified audience telemetry is present to establish demand."), long("Rights and release readiness require independent verification.")] };
    case "positioning": return { aAndRPositioning: { primaryLane: "R&B", adjacentLanes: ["Alternative R&B"], rationale: rat }, commercialRead: { marketability: "high", rationale: rat } };
    case "release": return { releaseStrategy: { recommendation: rat, priorities: [long("Verify master and release identity fields against authoritative sources."), long("Complete a human listening review with time-coded observations."), long("Collect platform-native performance data before commercial claims.")] } };
    case "evidence-score": return { evidenceGaps: [long("No verified audience telemetry or conversion evidence was supplied.")], confidence: 0.5, limitations: [long("The assessment is limited to the evidence fields supplied for this request.")], scorecard: Object.fromEntries(["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"].map(k => [k, { score: null, rationale: rat }])), humanListeningChecklist: ["Does the opening create a clear reason to continue?", "Can the hook be recalled after one play?", "Does the vocal delivery communicate a distinctive point of view?", "What feels original against verified references?", "Does the arrangement create development and payoff?", "Can a listener describe the lane without prompting?"].map(x => long(x, 8)), evidenceLabels: [{ label: "INDUSTRY PRACTICE", claim: long("General release craft guidance is separate from claims about this particular recording."), source: "industry_practice" }] };
    case "production": return { productionArrangementGuidance: rat, industryPractice: rat, listeningChecks: [long("Check the opening and section transitions against the master."), long("Review vocal and instrumental balance across dense sections."), long("Check low-end translation and the ending on multiple systems."), long("Record any production observation with a time-coded reference.")] };
    case "comparables": return { laneHypothesis: rat, referencesToVerify: [long("Search verified releases for similar arrangement and vocal treatment."), long("Compare tempo feel and sound palette using full recordings."), long("Verify release identity and context before naming a reference.")], verificationMethod: rat };
    case "promotion": return { promotionPlan: { preRelease: rat, releaseWindow: rat, postRelease: rat, contentIdeas: [long("Create an approved performance excerpt."), long("Prepare a verified artist-story clip."), long("Develop a rights-cleared production breakdown."), long("Test an approved visual motif.")], pitchingAngles: [long("Lead with the verified musical feature that distinguishes the recording."), long("Connect the artist story to a source-checked release reason."), long("Frame the track for a relevant lane category without implying acceptance.")], playlistCategories: ["Lane-specific R&B discovery", "Alternative R&B programming", "Mood-led independent discovery"].map(x => long(x, 4)), industryPractice: rat } };
    case "label-fit": return { labelPartnerFit: { partnerProfile: rat, criteriaToDemonstrate: [long("Demonstrate a clear artist proposition with approved recordings."), long("Provide complete rights and credits information."), long("Show a consistent creative direction."), long("Document a credible release plan and responsibilities.")], diligenceBeforeContact: rat, industryPractice: rat } };
    default: return { executionPlan: { days30: rat, days60: rat, days90: rat } };
  }
}
const ALL_GROUPS = ["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"];
function okResponse(group: string): Response {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validSection(group)) } }],
    usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000 },
  }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GPT-OSS reasoning-effort control (hypothesis branch, mocked fetch)", () => {
  it("sends reasoning_effort=low by default for openai/gpt-oss-120b on every section", async () => {
    const efforts: Array<unknown> = [];
    const groups = new Set<string>();
    const mock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      groups.add(String(JSON.parse(body.messages[1].content).sectionGroup));
      return okResponse(String(JSON.parse(body.messages[1].content).sectionGroup));
    });
    await new GroqClient("k", "openai/gpt-oss-120b", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Reasoning Fixture" }, sonicDna: null });
    expect(efforts).toHaveLength(ALL_GROUPS.length);
    expect(new Set(efforts)).toEqual(new Set(["low"]));
    expect([...groups].sort()).toEqual([...ALL_GROUPS].sort());
  });

  it("honors an explicit valid GROQ_REASONING_EFFORT override", async () => {
    vi.stubEnv("GROQ_REASONING_EFFORT", "high");
    const efforts: Array<unknown> = [];
    const mock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      return okResponse(String(JSON.parse(body.messages[1].content).sectionGroup));
    });
    await new GroqClient("k", "openai/gpt-oss-120b", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Reasoning Fixture" }, sonicDna: null });
    expect(new Set(efforts)).toEqual(new Set(["high"]));
  });

  it("ignores an invalid override and falls back to low", async () => {
    vi.stubEnv("GROQ_REASONING_EFFORT", "extreme");
    const efforts: Array<unknown> = [];
    const mock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      return okResponse(String(JSON.parse(body.messages[1].content).sectionGroup));
    });
    await new GroqClient("k", "openai/gpt-oss-120b", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Reasoning Fixture" }, sonicDna: null });
    expect(new Set(efforts)).toEqual(new Set(["low"]));
  });

  it("does not add reasoning_effort for a non-reasoning model", async () => {
    const efforts: Array<unknown> = [];
    const mock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      return okResponse(String(JSON.parse(body.messages[1].content).sectionGroup));
    });
    await new GroqClient("k", "llama-3.3-70b-versatile", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Reasoning Fixture" }, sonicDna: null });
    expect(efforts.every(value => value === undefined)).toBe(true);
  });
});

describe("reasoning-token diagnostic capture (hypothesis branch, mocked fetch)", () => {
  it("captures completion_tokens_details.reasoning_tokens and reasoning content presence without changing validation", async () => {
    const usageLogs: Array<Record<string, unknown>> = [];
    const spy = vi.spyOn(console, "info").mockImplementation((message?: unknown) => {
      if (typeof message === "string") {
        try {
          const event = JSON.parse(message) as Record<string, unknown>;
          if (event.event === "response_usage") usageLogs.push(event);
        } catch { /* ignore */ }
      }
    });
    const mock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const group = String(JSON.parse(body.messages[1].content).sectionGroup);
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validSection(group)), reasoning: "internal step" } }],
        usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000, completion_tokens_details: { reasoning_tokens: 320 } },
      }), { status: 200 });
    });
    const result = await new GroqClient("k", "openai/gpt-oss-120b", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Reasoning Fixture" }, sonicDna: null });
    expect(result.assessmentVersion).toBe("3.0");
    expect(usageLogs.length).toBeGreaterThan(0);
    expect(usageLogs[0].actualReasoningTokens).toBe(320);
    expect(usageLogs[0].reasoningContentPresent).toBe(true);
  });
});
