import { describe, expect, it, vi } from "vitest";
import { GroqClient, GeminiClient, type ProviderAttemptDiagnostic } from "../src/providers/groq/client.js";

/** Production estimator: serialized prompt bytes / 2 + 256 framing tokens. */
function estimatedInputTokens(messages: unknown, responseFormat: unknown): number {
  return Math.ceil(new TextEncoder().encode(JSON.stringify({ messages, response_format: responseFormat })).length / 2) + 256;
}

const long = (s: string, n = 65) => { let v = s; while (v.trim().split(/\s+/).length < n) v += " " + s; return v; };
const rationale = long("The supplied evidence supports this limited assessment while important source limitations remain and require verification before any external decision.");

function validSection(group: string): Record<string, unknown> {
  switch (group) {
    case "narrative": return { assessmentVersion: "3.0", executiveSummary: long("This assessment separates supplied track evidence from interpretation and general industry practice. No unsupported audience or commercial claims are made."), creativeIdentity: long("This creative identity description is a provisional interpretation of the supplied evidence and requires full listening review before external use."), strengths: [long("The source record provides a traceable identity field for this assessment."), long("The supplied evidence supports a limited and clearly bounded analysis."), long("The assessment records the outstanding verification requirements.")], risks: [long("No verified audience telemetry is present to establish demand or conversion."), long("Rights and release readiness require independent source verification.")] };
    case "positioning": return { aAndRPositioning: { primaryLane: "R&B", adjacentLanes: ["Alternative R&B"], rationale }, commercialRead: { marketability: "high", rationale } };
    case "release": return { releaseStrategy: { recommendation: rationale, priorities: [long("Verify master and release identity fields against authoritative source records."), long("Complete a human listening review and document time-coded observations."), long("Collect platform-native performance data before making commercial claims.")] } };
    case "evidence-score": return { evidenceGaps: [long("No verified audience telemetry or conversion evidence was supplied.")], confidence: 0.5, limitations: [long("The assessment is limited to the evidence fields supplied for this request.")], scorecard: Object.fromEntries(["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"].map(k => [k, { score: k === "dynamicRangeLoudness" ? 76 : k === "metadataCompleteness" ? 65 : k === "releaseReadiness" ? 55 : null, rationale }])), humanListeningChecklist: ["Does the opening create a clear reason to continue listening?", "Can the hook be recalled after one play and which phrase carries it?", "Does the vocal delivery communicate a distinctive point of view?", "What feels genuinely original against verified references, and what production details should be checked?", "Does the arrangement create development and payoff without excess repetition?", "Can a first-time listener describe the lane without prompting, and which audible details support it?"].map(x => long(x, 8)), evidenceLabels: [{ label: "INDUSTRY PRACTICE", claim: long("General release craft guidance is separate from claims about this particular recording."), source: "industry_practice" }] };
    case "production": return { productionArrangementGuidance: rationale, industryPractice: rationale, listeningChecks: [long("Check the opening and section transitions against the complete approved master."), long("Review vocal and instrumental balance across dense and sparse sections."), long("Check low-end translation and the ending on multiple playback systems."), long("Record any production observation with a time-coded reference.")] };
    case "comparables": return { laneHypothesis: rationale, referencesToVerify: [long("Search verified releases for similar arrangement and vocal treatment."), long("Compare tempo feel and sound palette using full recordings."), long("Verify release identity and context before naming a reference.")], verificationMethod: rationale };
    case "promotion": return { promotionPlan: { preRelease: rationale, releaseWindow: rationale, postRelease: rationale, contentIdeas: [long("Create an approved performance excerpt."), long("Prepare a verified artist-story clip."), long("Develop a rights-cleared production breakdown."), long("Test an approved visual motif.")], pitchingAngles: [long("Lead with the verified musical feature that distinguishes the approved recording."), long("Connect the artist story to a specific and source-checked release reason."), long("Frame the track for a relevant lane category without implying acceptance.")], playlistCategories: ["Lane-specific R&B discovery", "Alternative R&B programming", "Mood-led independent discovery"].map(x => long(x, 4)), industryPractice: rationale } };
    case "label-fit": return { labelPartnerFit: { partnerProfile: rationale, criteriaToDemonstrate: [long("Demonstrate a clear artist proposition with approved recordings."), long("Provide complete rights and credits information."), long("Show a consistent creative direction."), long("Document a credible release plan and responsibilities.")], diligenceBeforeContact: rationale, industryPractice: rationale } };
    default: return { executionPlan: { days30: rationale, days60: rationale, days90: rationale } };
  }
}

const ALL_GROUPS = ["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"];

/** Production-shaped evidence: verbose field-level provenance from several providers. */
function productionEvidence(kind: "master" | "dsp_link" = "master"): Record<string, unknown> {
  const verbose = (label: string, index: number) => (label + " " + index + " with source-attributed supporting catalog detail ").repeat(12);
  const provenance = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ["field" + index, {
    source: verbose("source", index), provider: verbose("provider", index), status: verbose("status", index),
    confidence: 0.91, evidenceClass: verbose("evidenceClass", index), value: verbose("value", index),
    normalizedValue: verbose("normalizedValue", index), matchStatus: verbose("matchStatus", index),
  }]));
  return {
    auditType: kind === "master" ? "MASTER-BASED AUDIT" : "METADATA-BASED AUDIT",
    sourceType: kind, artist: "Escalation Fixture", title: "Long Evidence Track", isrc: "NGABC2600001",
    sourceProviders: ["musicbrainz", "audD", "lastfm"], fieldProvenance: provenance,
    identity: { artist: "Escalation Fixture", title: "Long Evidence Track", isrc: "NGABC2600001" },
    reconciliation: { status: "RECONCILED", conflicts: [], matchedFields: ["artist", "title", "isrc"] },
  };
}

function okResponse(group: string, promptTokens: number): Response {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validSection(group)) } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: 500, total_tokens: promptTokens + 500 },
  }), { status: 200 });
}
function truncatedResponse(budget: number, promptTokens: number): Response {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "length", message: { content: '{"assessmentVersion":"3.0","executiveSummary":' } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: budget, total_tokens: promptTokens + budget },
  }), { status: 200 });
}

function assertBudgetInvariants(mock: ReturnType<typeof vi.fn>): void {
  for (const call of mock.mock.calls) {
    const body = JSON.parse(String(call[1]?.body));
    const estimate = estimatedInputTokens(body.messages, body.response_format);
    expect(estimate + body.max_completion_tokens).toBeLessThanOrEqual(6000);
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(256);
    expect(body.max_completion_tokens).toBeLessThanOrEqual(2000);
  }
}

describe("Groq truncation escalation on production-sized evidence", () => {
  for (const reportedPromptTokens of [3800, 4600]) {
    it("escalates the ACTUALLY SENT allowance through repeated truncation and completes all nine sections (usage=" + reportedPromptTokens + ")", async () => {
      const narrativeFormats: string[] = [];
      const narrativeBudgets: number[] = [];
      const narrativePayloads: Array<Record<string, unknown>> = [];
      const groupsSeen = new Set<string>();
      const attempts: ProviderAttemptDiagnostic[] = [];
      let narrativeCalls = 0;
      const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const payload = JSON.parse(body.messages[1].content);
        groupsSeen.add(payload.sectionGroup);
        if (payload.sectionGroup === "narrative") {
          narrativeCalls++;
          narrativeFormats.push(body.response_format?.type);
          narrativeBudgets.push(body.max_completion_tokens);
          narrativePayloads.push(payload);
          if (narrativeCalls <= 3) return truncatedResponse(body.max_completion_tokens, reportedPromptTokens);
        }
        return okResponse(payload.sectionGroup, reportedPromptTokens);
      });

      const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence: productionEvidence(), sonicDna: null,
          recordProviderAttempt: async attempt => { attempts.push(attempt); } });

      expect(result.assessmentVersion).toBe("3.0");
      expect(narrativeBudgets).toEqual([850, 1275, 1913, 2000]);
      expect(narrativeFormats).toEqual(Array(4).fill("json_schema"));
      // Strict mode must not inject a duplicated outputSchema into the user payload.
      expect(narrativePayloads.every(item => item.outputSchema === undefined)).toBe(true);
      expect([...groupsSeen].sort()).toEqual([...ALL_GROUPS].sort());
      expect(attempts.filter(item => item.failureKind === "completion_truncated")).toHaveLength(3);
      assertBudgetInvariants(mock);
    });
  }

  it("stops explicitly instead of replaying identical truncation requests forever", async () => {
    const narrativeBudgets: number[] = [];
    let narrativeCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative") {
        narrativeCalls++;
        narrativeBudgets.push(body.max_completion_tokens);
        return truncatedResponse(body.max_completion_tokens, 3800);
      }
      return okResponse(payload.sectionGroup, 3800);
    });
    await expect(new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: productionEvidence(), sonicDna: null }))
      .rejects.toThrow(/AI_PROVIDER_COMPLETION_TRUNCATED|completion allowance cannot be increased/);
    expect(narrativeCalls).toBeLessThanOrEqual(6);
    // No more than one duplicate of the terminal allowance is ever dispatched.
    const terminal = narrativeBudgets[narrativeBudgets.length - 1];
    expect(narrativeBudgets.filter(budget => budget === terminal).length).toBeLessThanOrEqual(2);
    assertBudgetInvariants(mock);
  });

  it("completes all nine sections for both uploaded-master and DSP-link evidence shapes", async () => {
    for (const kind of ["master", "dsp_link"] as const) {
      const groupsSeen = new Set<string>();
      const sonicDna = kind === "master"
        ? { provenance: "uploaded_audio_master", evidenceClass: "OBSERVED", bpm: 96, tempoConfidence: 0.8 }
        : null;
      const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const payload = JSON.parse(body.messages[1].content);
        groupsSeen.add(payload.sectionGroup);
        return okResponse(payload.sectionGroup, 2500);
      });
      const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence: productionEvidence(kind), sonicDna });
      expect(result.assessmentVersion).toBe("3.0");
      expect([...groupsSeen].sort()).toEqual([...ALL_GROUPS].sort());
      assertBudgetInvariants(mock);
    }
  });
});

describe("Groq field-level narrative repair under compaction", () => {
  it("keeps the full nested field path and every exact minimum in a compacted word-count repair", async () => {
    const retries: Array<Record<string, unknown>> = [];
    const retryFormats: string[] = [];
    let scoreCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "evidence-score") {
        scoreCalls++;
        if (scoreCalls === 1) {
          const invalid = validSection("evidence-score") as Record<string, any>;
          // Long tokens keep the value above the 80-character Zod floor while
          // remaining below the 25-word local contract, so this exercises the
          // word-count (not schema) recovery path.
          const shortRationale = Array.from({ length: 12 }, (_, i) => "substantiated" + i).join(" ");
          invalid.scorecard.tempoLaneFit.rationale = shortRationale;
          invalid.scorecard.rhythmicConsistency.rationale = shortRationale;
          invalid.evidenceGaps = ["Missing audience telemetry evidence"];
          return new Response(JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid) } }],
            usage: { prompt_tokens: 3800, completion_tokens: 500, total_tokens: 4300 },
          }), { status: 200 });
        }
        retries.push(payload);
        retryFormats.push(body.response_format?.type);
      }
      return okResponse(payload.sectionGroup, 3800);
    });

    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: productionEvidence(), sonicDna: null });

    expect(result.assessmentVersion).toBe("3.0");
    expect(retries.length).toBeGreaterThan(0);
    const correction = String(retries[0].correction ?? "");
    // Full dotted paths must survive compaction (a `[^.]*` match used to reduce
    // "scorecard.tempoLaneFit.rationale" to just "rationale").
    expect(correction).toContain("scorecard.tempoLaneFit.rationale must contain at least 25 words");
    expect(correction).toContain("scorecard.rhythmicConsistency.rationale must contain at least 25 words");
    expect(correction).toContain("evidenceGaps[0] must contain at least 8 words");
    // A pure word-count miss must not downgrade Groq's strict structured output.
    expect(retryFormats[0]).toBe("json_schema");
    assertBudgetInvariants(mock);
  });

  it("retains every simultaneous field minimum rather than truncating the correction at 360 characters", async () => {
    const retries: Array<Record<string, unknown>> = [];
    let scoreCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "evidence-score") {
        scoreCalls++;
        if (scoreCalls === 1) {
          const invalid = validSection("evidence-score") as Record<string, any>;
          const shortRationale = Array.from({ length: 12 }, (_, i) => "substantiated" + i).join(" ");
          for (const key of ["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"]) {
            invalid.scorecard[key].rationale = shortRationale;
          }
          return new Response(JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid) } }],
            usage: { prompt_tokens: 3800, completion_tokens: 500, total_tokens: 4300 },
          }), { status: 200 });
        }
        retries.push(payload);
      }
      return okResponse(payload.sectionGroup, 3800);
    });
    await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: productionEvidence(), sonicDna: null });
    const correction = String(retries[0].correction ?? "");
    for (const key of ["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"]) {
      expect(correction).toContain("scorecard." + key + ".rationale must contain at least 25 words");
    }
    assertBudgetInvariants(mock);
  });
});

describe("Groq section-cache resume and provider isolation", () => {
  it("resumes from the first genuinely missing section without overwriting completed ones", async () => {
    const cachedGroups = new Set(["narrative", "positioning", "release", "evidence-score"]);
    const requested: string[] = [];
    const saved: Array<{ group: string; provider: string }> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      requested.push(payload.sectionGroup);
      return okResponse(payload.sectionGroup, 2500);
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: { artist: "Resume Fixture" }, sonicDna: null,
        loadCompletedSectionGroup: async (group, provider) => provider === "groq" && cachedGroups.has(group) ? validSection(group) : null,
        saveCompletedSectionGroup: async (group, _result, provider) => { saved.push({ group, provider }); },
      });
    expect(result.assessmentVersion).toBe("3.0");
    expect(requested.sort()).toEqual(ALL_GROUPS.filter(group => !cachedGroups.has(group)).sort());
    expect(saved).toHaveLength(5);
    expect(new Set(saved.map(item => item.group)).size).toBe(5);
  });

  it("does not reuse Groq's cached sections for a different provider", async () => {
    const requested: string[] = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      requested.push(payload.sectionGroup);
      return okResponse(payload.sectionGroup, 2500);
    });
    const groqCached = new Set(ALL_GROUPS);
    await new GeminiClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: { artist: "Cache Isolation Fixture" }, sonicDna: null,
        loadCompletedSectionGroup: async (group, provider) => provider === "groq" && groqCached.has(group) ? validSection(group) : null,
      });
    expect(requested.sort()).toEqual([...ALL_GROUPS].sort());
  });
});
