import { describe, expect, it, vi } from "vitest";
import { processAuditJob, type AuditProcessorDependencies } from "../src/jobs/process-audit-job.js";
import { GroqClient, AssessmentSchema, type ArAssessment, type ProviderAttemptDiagnostic } from "../src/providers/groq/client.js";
import { getAuditProgress } from "../src/jobs/audit-progress.js";
import type { CatalogMetadata } from "../src/providers/dsp/catalog.js";

const CLAIM_TOKEN = "11111111-1111-4111-8111-111111111111";
const ALL_GROUPS = ["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"];
const PDF = new Uint8Array([37, 80, 68, 70, 45]);

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

function id3Fixture(): Uint8Array {
  const encoder = new TextEncoder();
  const frame = (id: string, value: string): number[] => {
    const data = [3, ...encoder.encode(value)];
    return [...encoder.encode(id), 0, 0, 0, data.length, 0, 0, ...data];
  };
  const frames = [
    ...frame("TIT2", "Embedded Title"), ...frame("TPE1", "Embedded Artist"),
    ...frame("TALB", "Embedded Album"), ...frame("TSRC", "NGABC2600001"),
    ...frame("TCON", "Afrobeats"), ...frame("TDRC", "2025-08-27"),
    ...frame("TPUB", "BlackBeard Entertainment"),
  ];
  const size = frames.length;
  return new Uint8Array([73, 68, 51, 4, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127, ...frames]);
}

function catalogSource(url: string): CatalogMetadata {
  return {
    platform: "apple_music", sourceUrl: url, canonicalUrl: url, catalogId: "apple-music-e2e",
    artist: "E2E Artist", title: "E2E Track", album: "E2E Album", releaseDate: "2026-01-15",
    isrc: "NGABC2600001", upc: null, catalogPopularity: null, catalogPopularityScale: null,
    label: null, genre: "Afrobeats", artworkUrl: null, previewUrl: null,
    externalIds: { apple_music: "apple-music-e2e" }, sonicProfile: null, raw: {},
    evidenceStatus: "recognized",
  };
}

interface E2EState {
  events: string[];
  groupsSeen: string[];
  savedAssessment: ArAssessment | null;
  savedReports: string[];
  sectionSaves: string[];
  attempts: ProviderAttemptDiagnostic[];
  markCompletedCalls: number;
  markFailedCalls: number;
  lastFailure: string;
  assessmentError: string;
  cache: Map<string, unknown>;
}

function buildGroqFetch(state: E2EState): typeof fetch {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const group = String(JSON.parse(body.messages[1].content).sectionGroup ?? "");
    state.groupsSeen.push(group);
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validSection(group)) } }],
      usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000 },
    }), { status: 200 });
  }) as unknown as typeof fetch;
}

function buildDeps(mode: "master" | "dsp_link", state: E2EState): AuditProcessorDependencies {
  const cacheKey = (group: string, provider: string, model: string) => provider + ":" + model + ":" + group;
  const client = new GroqClient("test-key", "test-model", buildGroqFetch(state), async () => {});
  const url = "https://music.apple.com/us/album/song/12345?i=67890";
  return {
    getJob: async () => ({
      id: "e2e-" + mode, ownerId: null,
      sourceAudioPath: mode === "master" ? "owner/e2e/master.mp3" : null,
      mimeType: mode === "master" ? "audio/mpeg" : null,
      filename: null, sourceType: mode,
      catalogUrl: mode === "dsp_link" ? url : null,
      catalogUrls: mode === "dsp_link" ? [url] : undefined,
      status: "processing", claimToken: CLAIM_TOKEN,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z", workerId: "e2e-worker",
    }),
    markProcessing: async () => { state.events.push("processing"); },
    collectCatalogMetadata: async () => catalogSource(url),
    collectIsrcCatalogMetadata: async (isrc) => ({ isrc, metadata: [], outcomes: [{ provider: "musicbrainz", status: "partial", reason: "External lookup intentionally mocked." }] }),
    recognizeUrl: async () => ({ matched: false as const }),
    downloadMaster: async () => id3Fixture(),
    createRecognitionSample: async () => new Uint8Array([4, 5]),
    recognize: async () => ({ matched: false as const }),
    saveRecognition: async () => { state.events.push("recognition"); },
    saveSonicDna: async () => { state.events.push("sonic_dna"); },
    saveEvidence: async () => { state.events.push("evidence"); },
    saveCatalogMetadata: async () => { state.events.push("catalog"); },
    decode: async () => ({ samples: new Float32Array([0, 0, 0.1, 0.1, -0.1, -0.1, 0, 0]), sampleRate: 44100, channels: 2 }),
    discoverPlaylists: async () => { throw new Error("playlist discovery intentionally unavailable"); },
    generateAssessment: async (input, signal) => {
      state.events.push("assessment");
      try {
        return await client.assess({
        ...input,
        recordProviderAttempt: async attempt => { state.attempts.push(attempt); },
        loadCompletedSectionGroup: async (group, provider, model) => state.cache.get(cacheKey(group, provider, model)) ?? null,
        saveCompletedSectionGroup: async (group, result, provider, model) => {
          state.sectionSaves.push(group);
          state.cache.set(cacheKey(group, provider, model), result);
        },
      }, signal);
      } catch (error) {
        state.assessmentError = "assessment: " + (error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    saveAssessment: async (_jobId, _claimToken, assessment) => {
      state.savedAssessment = assessment;
      state.events.push("assessment-saved");
    },
    generateReport: async (_input, tier) => { state.events.push("report-" + tier); return PDF; },
    saveReport: async (_jobId, _claimToken, tier, pdf) => {
      expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
      state.savedReports.push(tier);
      state.events.push("report-saved-" + tier);
    },
    markCompleted: async () => { state.markCompletedCalls++; state.events.push("completed"); },
    markFailed: async (_jobId, _claimToken, message) => { state.markFailedCalls++; state.lastFailure = message; state.events.push("failed"); },
  };
}

function freshState(): E2EState {
  return { events: [], groupsSeen: [], savedAssessment: null, savedReports: [], sectionSaves: [], attempts: [], markCompletedCalls: 0, markFailedCalls: 0, lastFailure: "", assessmentError: "", cache: new Map() };
}

describe("end-to-end A&R audit acceptance", () => {
  for (const mode of ["master", "dsp_link"] as const) {
    it("runs " + mode + " intake through nine validated sections, both PDF tiers and a genuine completed status", async () => {
      const state = freshState();
      const result = await processAuditJob("e2e-" + mode, buildDeps(mode, state));

      expect(result.status, state.assessmentError + " | " + state.lastFailure + " | " + state.events.join(",")).toBe("completed");
      expect(state.markFailedCalls).toBe(0);
      expect(state.markCompletedCalls).toBe(1);
      expect([...new Set(state.groupsSeen)].sort()).toEqual([...ALL_GROUPS].sort());
      // No duplicate section persistence and every one of the nine sections saved.
      expect(new Set(state.sectionSaves).size).toBe(9);
      expect(state.sectionSaves).toHaveLength(9);
      // The persisted assessment is genuinely schema-valid, not a stub.
      expect(state.savedAssessment).not.toBeNull();
      const parsed = AssessmentSchema.safeParse(state.savedAssessment);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 6))).toBe(true);
      expect(state.savedAssessment?.generationProvenance.provider).toBe("groq");
      expect(state.savedAssessment?.assessmentVersion).toBe("3.0");
      // Both report tiers persisted.
      expect(state.savedReports.sort()).toEqual(["full", "sample"]);
      // Completion is the terminal event; 100% progress only after that event.
      expect(state.events.at(-1)).toBe("completed");
      const beforeCompletion = getAuditProgress([], "processing", mode);
      expect(beforeCompletion.overallPercent).toBeLessThan(100);
      const afterCompletion = getAuditProgress([
        { event_type: "catalog_ingestion" }, { event_type: "sonic_dna" },
        { event_type: "evidence_reconciliation" }, { event_type: "ar_assessment" },
        { event_type: "report_generated", payload: { tier: "sample" } },
        { event_type: "report_generated", payload: { tier: "full" } },
        { event_type: "audit_completed" },
      ], "completed", mode);
      expect(afterCompletion.overallPercent).toBe(100);
      // Every provider attempt stayed within the shared 6,000-token ceiling.
      expect(state.attempts.every(attempt => attempt.failureKind === undefined)).toBe(true);
    });
  }

  it("reprocessing a completed audit reuses cached sections without duplicate persistence", async () => {
    const state = freshState();
    const first = await processAuditJob("e2e-master", buildDeps("master", state));
    expect(first.status).toBe("completed");
    expect(state.sectionSaves).toHaveLength(9);

    const secondState: E2EState = { ...freshState(), cache: new Map(state.cache) };
    const second = await processAuditJob("e2e-master", buildDeps("master", secondState));
    expect(second.status).toBe("completed");
    // All nine groups came from the provider-scoped resume cache.
    expect(secondState.groupsSeen).toHaveLength(0);
    expect(secondState.sectionSaves).toHaveLength(0);
    expect(secondState.savedAssessment?.assessmentVersion).toBe("3.0");
    expect(secondState.savedReports.sort()).toEqual(["full", "sample"]);
    expect(secondState.markFailedCalls).toBe(0);
  });
});
