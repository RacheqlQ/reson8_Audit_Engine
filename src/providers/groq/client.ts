import { z } from "zod";
import { sanitizeAssessmentForEvidence } from "../../reports/evidence-guardrails.js";
import { sharedGroqTokenLimiter } from "../token-per-minute-limiter.js";
import { markAssessmentProviderUnavailable } from "../provider-policy.js";

export const GROQ_PROMPT_VERSION = "audit-ar-v6-analysis-integration-2026-11-20";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const EvidenceLabelSchema = z.object({
  label: z.enum(["OBSERVED", "RECOGNIZED", "RECONCILED", "INFERRED", "INDUSTRY PRACTICE"]),
  claim: z.string().min(24),
  source: z.string().min(2),
});
const ScoreSchema = z.object({ score: z.number().min(0).max(100).nullable(), rationale: z.string().min(80) });
const NarrativeSchema = z.object({
  assessmentVersion: z.string().min(1),
  executiveSummary: z.string().min(120),
  creativeIdentity: z.string().min(100),
  strengths: z.array(z.string().min(20)).min(3).max(12),
  risks: z.array(z.string().min(20)).min(2).max(12),
});
const PositioningSchema = z.object({
  aAndRPositioning: z.object({
    primaryLane: z.string().min(1), adjacentLanes: z.array(z.string().min(1)).max(8),
    rationale: z.string().min(100),
  }),
  commercialRead: z.object({
    marketability: z.enum(["high", "moderate", "low", "undetermined"]), rationale: z.string().min(100),
  }),
});
const EvidenceScoreSchema = z.object({
  evidenceGaps: z.array(z.string().min(12)).min(1).max(12),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(12)).min(1).max(12),
  scorecard: z.object({
    tempoLaneFit: ScoreSchema,
    rhythmicConsistency: ScoreSchema,
    dynamicRangeLoudness: ScoreSchema,
    metadataCompleteness: ScoreSchema,
    releaseReadiness: ScoreSchema,
  }),
  humanListeningChecklist: z.array(z.string().min(20)).min(5).max(12),
  evidenceLabels: z.array(EvidenceLabelSchema).min(1).max(32),
});
const ReleaseSchema = z.object({
  releaseStrategy: z.object({
    recommendation: z.string().min(100), priorities: z.array(z.string().min(20)).min(3).max(10),
  }),
});
const ProductionSchema = z.object({
  productionArrangementGuidance: z.string().min(240),
  industryPractice: z.string().min(160),
  listeningChecks: z.array(z.string().min(24)).min(4).max(8),
});
const ComparableSchema = z.object({
  laneHypothesis: z.string().min(100),
  referencesToVerify: z.array(z.string().min(30)).min(3).max(6),
  verificationMethod: z.string().min(100),
});
const PromotionSchema = z.object({
  promotionPlan: z.object({
    preRelease: z.string().min(100), releaseWindow: z.string().min(100), postRelease: z.string().min(100),
    contentIdeas: z.array(z.string().min(24)).min(4).max(8),
    pitchingAngles: z.array(z.string().min(24)).min(3).max(6),
    playlistCategories: z.array(z.string().min(1)).min(3).max(8),
    industryPractice: z.string().min(120),
  }),
});
const LabelFitSchema = z.object({
  labelPartnerFit: z.object({
    partnerProfile: z.string().min(120), criteriaToDemonstrate: z.array(z.string().min(24)).min(4).max(8),
    diligenceBeforeContact: z.string().min(100), industryPractice: z.string().min(120),
  }),
});
const TimelineSchema = z.object({
  executionPlan: z.object({
    days30: z.string().min(100), days60: z.string().min(100), days90: z.string().min(100),
  }),
});

const AssessmentSchema = NarrativeSchema.extend(PositioningSchema.shape).extend(ReleaseSchema.shape)
  .extend(EvidenceScoreSchema.shape).extend(ProductionSchema.shape).extend(ComparableSchema.shape)
  .extend(PromotionSchema.shape).extend(LabelFitSchema.shape).extend(TimelineSchema.shape);
export type ArAssessment = z.infer<typeof AssessmentSchema>;

export interface ProviderAttemptDiagnostic {
  provider: "groq" | "gemini" | "ollama";
  model: string;
  status: number | null;
  errorType: "none" | "capacity" | "auth" | "malformed_output" | "timeout" | "provider_unavailable" | "provider_error";
  retryable: boolean;
  attempt: number;
}
export interface GroqAssessmentInput {
  evidence: Record<string, unknown>;
  recordProviderAttempt?: (attempt: ProviderAttemptDiagnostic) => Promise<void>;
  sonicDna: Record<string, unknown> | null;
  catalogMetadata?: Record<string, unknown> | null;
  loadCompletedSectionGroup?: (group: string) => Promise<unknown | null>;
  saveCompletedSectionGroup?: (group: string, result: unknown) => Promise<void>;
}
export interface GroqAssessmentClient { assess(input: GroqAssessmentInput, signal?: AbortSignal): Promise<ArAssessment>; }

const SYSTEM_PROMPT = [
  "You are the A&R intelligence analyst for a private music-audit service.",
  "Use only supplied evidence for track-specific claims. Never invent streams, sales, revenue, playlist data, named playlists, curators, demographics, market size, audience metrics, label interest, placements, or external facts.",
  "Evidence classes are strict and mutually distinct: OBSERVED is measured directly from the uploaded audio master only; RECOGNIZED is a claim returned by one named external identification or DSP source; RECONCILED is a field corroborated by at least two independent named providers with no conflict; INFERRED is a clearly labelled hypothesis or interpretation, including all A&R genre, lane, positioning and comparable hypotheses; INDUSTRY PRACTICE is general genre/release craft guidance and is not a fifth evidence tier.",
  "INDUSTRY PRACTICE must be explicitly separated from facts about this track. It may describe typical lane arrangement conventions, release sequencing norms, pitching angles, playlist categories only, content ideas, and label criteria. Never imply those practices were observed in this recording.",
  "Every evidence label must name its actual source. For INFERRED use source groq_assessment to identify an A&R hypothesis, including genre or lane positioning; for INDUSTRY PRACTICE use source industry_practice. Do not label recommendations as observed facts or hypotheses as measurements.",
  "When sonicDna.genreClassification is supplied, treat its provider-backed genres as source-weighted evidence, keep region and city-scene tags separate from genre labels, and retain unmapped provider tags as unresolved. If primaryGenre is null or abstained is true, do not state a definitive genre. Tempo is only a weak prior capped at fifteen percent of the genre score; never infer a genre from BPM alone. Describe genre and lane interpretations as INFERRED hypotheses, not OBSERVED facts.",
  "When tempoConfidence is missing, null, zero, or below 0.5, treat any BPM value as an unverified candidate: do not repeat the number, describe the track as fast/slow/high-energy on that basis, score tempoLaneFit or rhythmicConsistency, or use it in playlist/release recommendations. Abstain and state that confidence is insufficient. A confidence threshold is a conservative reporting gate, not a calibrated accuracy claim.",
  "When rhythmFeatures contains candidateScores, windowConsensus, or independentEstimator but the confirmed tempo field is null, do not claim the analysis returned no tempo candidate. State that provisional tempo evidence exists, describe its low-confidence/consensus limitation without promoting a candidate to confirmed BPM, and keep tempoLaneFit and rhythmicConsistency unscored.",
  "When harmonicFeatures.topCandidates or windowConsensus are present but the confirmed key/mode is null, preserve the candidate and disagreement context as provisional tonal evidence. Do not claim no tonal analysis was performed and do not assert a single key or mode.",
  "When acousticFeatureProfile.predictions.mood.status is provisional, use its supplied labels as provisional signal-derived descriptors in creativeIdentity or A&R positioning; explicitly state that they are heuristic, not calibrated perceptual probabilities, and do not claim provisional tags are unavailable. Do not infer listener emotion, playlist acceptance or market demand from them.",
  "When acousticFeatureProfile.predictions.energy.status is provisional, report the supplied low/moderate/high estimate as a heuristic signal descriptor with its score out of 100, never as a probability or validated perceptual-energy prediction.",
  "Use vocalFeatures only when its status is analyzed and report its measured activity/pitch descriptors with their limitations. If unavailable or not analyzed, explicitly abstain; do not infer voice presence, delivery, layering or lyrics.",
  "Only discuss verse, chorus, bridge, intro/outro or other section boundaries when an explicit track-structure analysis result is supplied. Do not infer song structure from genre, energy, tempo candidates or general arrangement conventions.",
  "Use reconciled identity fields, field provenance, catalogSources and external provider records when supplied. Name MusicBrainz or a DSP only when that provider actually returned a record; retain ISRC conflicts and ambiguous matches rather than choosing an unsupported identity.",
  "Strengths, risks and actionable recommendations must cite the actual supplied sonic, vocal, genre and catalog evidence. Do not substitute generic template prose when specific measurements or source conflicts are present; distinguish unavailable analysis from a low-confidence candidate that was calculated.",
  "If genreClassification.primaryGenre is null or genreClassification.abstained is true, A&R lane positioning must remain unconfirmed; do not fill the gap with tempo, mood, or generic genre stereotypes.",
  "When commercial-performance evidence is absent, marketability must be undetermined. Never infer demand from genre, tempo, catalog popularity or metadata.",
  "A null score means insufficient evidence. RMS-envelope spread and RMS dBFS are descriptive measurements, not mastering-readiness criteria; keep technical delivery readiness unscored unless destination-specific integrated-loudness, loudness-range and true-peak targets are supplied.",
  "scorecard.rhythmicConsistency.rationale must contain at least 25 words, including when its score is null; explain the specific missing timing evidence in a complete sentence rather than using a short label.",
  "Do not score artistic taste. Hook, originality, production quality, replay value and lane clarity belong only in the unscored human listening checklist. Include a distinct first-listen question for hook recall, originality against verified references, production/arrangement choices, replay impulse and lane clarity.",
  "All recommendations must be specific, actionable and grounded in supplied track evidence or clearly labelled INDUSTRY PRACTICE. Never invent artist/track comparables; give descriptors or search criteria for references to verify.",
  "Genre labels must exactly match labels supplied in sonicDna.genreClassification.genres; do not invent compound genre tags, synonyms or adjacent genre names. Keep any A&R interpretation separate from taxonomy-backed genre labels.",
  "A measured loudness near -11 LUFS is not by itself a reason to optimise or raise loudness; never recommend loudness changes without a specific measured technical fault and delivery target. A spectral centroid at or below 2,000 Hz must not be described as bright or bright-sounding. If the uploaded master has one channel, flag mono delivery as a distribution compatibility risk and recommend checking destination requirements; do not claim it is incompatible.",
  "Return JSON only, meet all schema and word-count requirements, and do not pad with repeated boilerplate."
].join(" ");

function words(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }
function thresholdError(name: string, value: unknown): string | null {
  const d = value as Record<string, any>;
  const text = (label: string, v: unknown, min: number) => typeof v === "string" && words(v) >= min ? null : label + " must contain at least " + min + " words.";
  const list = (label: string, v: unknown, count: number, min: number) => {
    if (!Array.isArray(v) || v.length < count) return label + " must contain at least " + count + " items.";
    for (let i=0;i<v.length;i++){const e=text(label+"["+i+"]",v[i],min);if(e)return e;} return null;
  };
  if(name==="narrative") return text("executiveSummary",d.executiveSummary,45) ?? text("creativeIdentity",d.creativeIdentity,35)
    ?? list("strengths",d.strengths,3,10) ?? list("risks",d.risks,2,10);
  if(name==="positioning") return text("positioning rationale",d.aAndRPositioning?.rationale,40) ?? text("commercial rationale",d.commercialRead?.rationale,40);
  if(name==="release") return text("recommendation",d.releaseStrategy?.recommendation,40) ?? list("priorities",d.releaseStrategy?.priorities,3,8);
  if(name==="evidence-score") {
    const s=d.scorecard??{};
    for(const key of ["tempoLaneFit","rhythmicConsistency","dynamicRangeLoudness","metadataCompleteness","releaseReadiness"]){const e=text("scorecard."+key+".rationale",s[key]?.rationale,25);if(e)return e;}
    return list("evidenceGaps",d.evidenceGaps,1,8) ?? list("limitations",d.limitations,1,8) ?? list("humanListeningChecklist",d.humanListeningChecklist,5,5);
  }
  if(name==="production") return text("productionArrangementGuidance",d.productionArrangementGuidance,40) ?? text("industryPractice",d.industryPractice,25) ?? list("listeningChecks",d.listeningChecks,4,5);
  if(name==="comparables") return text("laneHypothesis",d.laneHypothesis,20) ?? list("referencesToVerify",d.referencesToVerify,3,8) ?? text("verificationMethod",d.verificationMethod,20);
  if(name==="promotion") return text("preRelease",d.promotionPlan?.preRelease,20) ?? text("releaseWindow",d.promotionPlan?.releaseWindow,20) ?? text("postRelease",d.promotionPlan?.postRelease,20) ?? list("contentIdeas",d.promotionPlan?.contentIdeas,4,5) ?? list("pitchingAngles",d.promotionPlan?.pitchingAngles,3,5) ?? list("playlistCategories",d.promotionPlan?.playlistCategories,3,3) ?? text("industryPractice",d.promotionPlan?.industryPractice,20);
  if(name==="label-fit") return text("partnerProfile",d.labelPartnerFit?.partnerProfile,25) ?? list("criteriaToDemonstrate",d.labelPartnerFit?.criteriaToDemonstrate,4,5) ?? text("diligenceBeforeContact",d.labelPartnerFit?.diligenceBeforeContact,20) ?? text("industryPractice",d.labelPartnerFit?.industryPractice,20);
  if(name==="timeline") return text("days30",d.executionPlan?.days30,20) ?? text("days60",d.executionPlan?.days60,20) ?? text("days90",d.executionPlan?.days90,20);
  return null;
}

const MAX_PROVIDER_RETRY_DELAY_MS = 60_000;
let groqDailyCapUntil = 0;
let groqCompletionBudgetScale = 1;
const MAX_NETWORK_ATTEMPTS = 3;
export const GROQ_REQUEST_TIMEOUT_MS = 55_000;
export const GROQ_ASSESSMENT_TIMEOUT_MS = 4 * 60_000;
export const GEMINI_ASSESSMENT_TIMEOUT_MS = 3 * 60_000;
export const OLLAMA_ASSESSMENT_TIMEOUT_MS = 2 * 60_000;
const MAX_COMPLETION_TOKENS = 1200;
const MAX_GROQ_TOTAL_TOKENS = 6000;
const SECTION_COMPLETION_BUDGETS: Record<string, number> = {
  narrative: 850, positioning: 650, release: 500, "evidence-score": 1000,
  production: 650, comparables: 450, promotion: 900, "label-fit": 650, timeline: 500,
};
const MIN_COMPLETION_TOKENS = 256;
const MAX_SECTION_REQUEST_ATTEMPTS = 16;

async function providerRetryDelayMs(response: Response, fallbackAttempt: number): Promise<number> {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const headerDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(headerDelay) && headerDelay >= 0) {
      return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(headerDelay * (1 + Math.random() * 0.2)));
    }
  }

  const detail = await response.clone().text().catch(() => "");
  try {
    const payload = JSON.parse(detail) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === "string") {
      const match = payload.error.message.match(/try again in\s+(?:(\d+(?:\.\d+)?)m)?\s*(\d+(?:\.\d+)?)s/i);
      if (match) {
        const minutes = Number(match[1] ?? 0);
        const seconds = Number(match[2]);
        const delayMs = (minutes * 60 + seconds) * 1000;
        return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(delayMs));
      }
    }
  } catch {
    // Non-JSON provider errors use bounded exponential backoff below.
  }

  const exponential = 1000 * (2 ** fallbackAttempt);
  return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(exponential * (0.8 + Math.random() * 0.4)));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("Groq retry aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

function compactEvidenceForGroq(evidence: Record<string, unknown>, group: string): Record<string, unknown> {
  const common = [
    "auditType", "artist", "title", "album", "releaseDate", "label", "isrc", "upc",
    "genres", "sourceProviders", "fieldProvenance", "identity", "reconciliation",
    "genreClassification", "catalogSources", "sourceCombination", "masterAudio",
    "metadataSourcesChecked", "evidenceClass", "fixture",
  ];
  const groupFields: Record<string, string[]> = {
    narrative: ["commercialEvidence", "commercialPerformance", "commercialMetrics", "audienceTelemetry", "catalogPopularity", "rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved"],
    positioning: ["commercialEvidence", "commercialPerformance", "commercialMetrics", "audienceTelemetry", "catalogPopularity"],
    release: ["rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved"],
    "evidence-score": ["commercialEvidence", "commercialPerformance", "commercialMetrics", "audienceTelemetry", "rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved"],
    production: [],
    comparables: [],
    promotion: ["releaseStatus"],
    "label-fit": ["rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved"],
    timeline: ["rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved"],
  };
  const allowed = new Set([...common, ...(groupFields[group] ?? [])]);
  return Object.fromEntries(Object.entries(evidence).filter(([key]) => allowed.has(key)));
}

function compactPromptValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && value.length > 1200 ? value.slice(0, 1200) + " [truncated]" : value;
  }
  if (depth >= 5) {
    if (Array.isArray(value)) return value.slice(0, 8).filter((item) => item === null || typeof item !== "object");
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20)
      .filter(([, item]) => item === null || typeof item !== "object"));
  }
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => compactPromptValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40)
    .map(([key, item]) => [key, compactPromptValue(item, depth + 1)]));
}

function compactSonicDnaForGroq(sonicDna: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!sonicDna) return null;
  const compact: Record<string, unknown> = { ...sonicDna };

  const rhythm = sonicDna.rhythmFeatures;
  if (rhythm && typeof rhythm === "object" && !Array.isArray(rhythm)) {
    const summary = { ...(rhythm as Record<string, unknown>) };
    delete summary.onsetEnvelope;
    delete summary.beatTimesSeconds;
    delete summary.downbeatCandidateTimesSeconds;
    compact.rhythmFeatures = summary;
  }

  const harmonic = sonicDna.harmonicFeatures;
  if (harmonic && typeof harmonic === "object" && !Array.isArray(harmonic)) {
    const summary = { ...(harmonic as Record<string, unknown>) };
    delete summary.segmentChroma;
    compact.harmonicFeatures = summary;
  }

  return compactPromptValue(compact) as Record<string, unknown>;
}

async function recordProviderAttempt(input: GroqAssessmentInput, detail: ProviderAttemptDiagnostic): Promise<void> {
  console.info(JSON.stringify({ event: "provider_attempt", ...detail }));
  try {
    await input.recordProviderAttempt?.(detail);
  } catch {
    console.warn(JSON.stringify({ event: "provider_attempt_persist_failed", provider: detail.provider, model: detail.model }));
  }
}

function providerErrorType(status: number): ProviderAttemptDiagnostic["errorType"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 413 || status === 429) return "capacity";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

async function requestGroup<T>(fetchImpl: typeof fetch, apiKey: string, model: string, input: GroqAssessmentInput,
  groupName: string, instructions: string, schema: z.ZodType<T>, sleepImpl:(ms:number, signal?:AbortSignal)=>Promise<void>, signal?: AbortSignal, requestTimeoutMs = GROQ_REQUEST_TIMEOUT_MS, endpoint = "https://api.groq.com/openai/v1/chat/completions", providerName = "groq"): Promise<T> {
  let lastError = "No valid response was returned";
  let completionTokenBudget = MAX_COMPLETION_TOKENS;
  let strictSchemaRetries = 0;
  let jsonObjectProviderRetries = 0;
  let promptOnlyProviderRetries = 0;
  let strictContentRetries = 0;
  let jsonObjectContentRetries = 0;
  let promptOnlyContentRetries = 0;
  // Ollama Cloud supports JSON mode, not schema-constrained structured outputs.
  let responseMode: "json_schema" | "json_object" | "prompt_only" = providerName === "groq" ? "json_schema" : "json_object";
  const cacheGroupName = groupName;
  const providerLabel = providerName === "gemini" ? "Gemini" : providerName === "ollama" ? "Ollama" : "Groq";
  const tokenField = providerName === "groq" ? "max_completion_tokens" : "max_tokens";
  const outputSchema = z.toJSONSchema(schema);
  const completed = await input.loadCompletedSectionGroup?.(cacheGroupName);
  if (completed !== null && completed !== undefined) {
    const cached = schema.safeParse(completed);
    if (cached.success && !thresholdError(groupName, cached.data)) return cached.data;
  }

  const scheduleCorrection = (reason: string): boolean => {
    lastError = reason;
    if (responseMode === "json_schema" && strictContentRetries < 1) {
      strictContentRetries++;
      lastError += " Retry strict structured-output mode once with the complete corrected schema object.";
      return true;
    }
    if (responseMode === "json_schema") return false;
    if (responseMode === "json_object" && jsonObjectContentRetries < 2) {
      jsonObjectContentRetries++;
      lastError += " Correct every reported issue and return one complete object matching outputSchema.";
      return true;
    }
    if (responseMode === "json_object") {
      responseMode = "prompt_only";
      lastError += " JSON-object output did not validate. Switch to prompt-only JSON and match every field in outputSchema exactly.";
      return true;
    }
    if (responseMode === "prompt_only" && promptOnlyContentRetries < 2) {
      promptOnlyContentRetries++;
      lastError += " Correct every reported issue and return one complete raw JSON object matching outputSchema.";
      return true;
    }
    return false;
  };

  for (let attempt = 0; attempt < MAX_SECTION_REQUEST_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const fallbackMode = responseMode !== "json_schema";
    const schemaGuidance = fallbackMode
      ? " The user payload includes outputSchema, the exact normative output contract. Match every property, nested object, required field, type, enum, nullable value, array bound and minimum length. Return one complete JSON object only. Do not include outputSchema in the returned object. Local Zod and section word-count validation are mandatory."
      : "";
    const messages = [
      { role: "system", content: SYSTEM_PROMPT + " " + instructions + schemaGuidance },
      {
        role: "user",
        content: JSON.stringify({
          promptVersion: GROQ_PROMPT_VERSION,
          sectionGroup: groupName,
          evidence: compactPromptValue(compactEvidenceForGroq(input.evidence, groupName)),
          sonicDna: compactPromptValue(input.sonicDna),
          catalogMetadata: compactPromptValue(input.catalogMetadata ?? null),
          correction: attempt === 0 ? null : lastError,
          ...(fallbackMode ? { outputSchema } : {}),
        }),
      },
    ];
    const requestBody: Record<string, unknown> = {
      model,
      temperature: 0.1,
      [tokenField]: completionTokenBudget,
      messages,
    };
    if (responseMode === "json_schema") {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: { name: "ar_" + groupName, strict: true, schema: outputSchema },
      };
    } else if (responseMode === "json_object") {
      requestBody.response_format = { type: "json_object" };
    }
    // prompt_only deliberately omits response_format. The exact schema is still
    // supplied to the model, and no response is accepted without local Zod checks.
    const estimatedInputTokens = Math.ceil(new TextEncoder().encode(JSON.stringify({ messages, response_format: requestBody.response_format })).length / 3) + 256;
    const sectionOutputBudget = Math.floor(Math.min(MAX_COMPLETION_TOKENS, SECTION_COMPLETION_BUDGETS[groupName] ?? 600) * (providerName === "groq" ? groqCompletionBudgetScale : 1));
    const groqTpmBudgetApplies = providerName === "groq";
    // The 6,000-token ceiling is a Groq TPM safeguard, not a global model
    // output limit. Applying it to Gemini/Ollama starved evidence-score of its
    // 1,000-token module budget even when those providers had ample capacity.
    completionTokenBudget = groqTpmBudgetApplies
      ? Math.min(sectionOutputBudget, MAX_GROQ_TOTAL_TOKENS - estimatedInputTokens)
      : sectionOutputBudget;
    if (groqTpmBudgetApplies && (completionTokenBudget < MIN_COMPLETION_TOKENS || estimatedInputTokens + completionTokenBudget > MAX_GROQ_TOTAL_TOKENS)) {
      throw new Error("GROQ_PROMPT_BUDGET_EXCEEDED: section payload cannot fit within the 6,000-token request budget");
    }
    requestBody[tokenField] = completionTokenBudget;
    if (groqTpmBudgetApplies && process.env.NODE_ENV !== "test") {
      await sharedGroqTokenLimiter.acquire(estimatedInputTokens + completionTokenBudget, sleepImpl, signal);
    }
    console.info(JSON.stringify({ provider: providerName, event: "request_budget", group: groupName, estimatedInputTokens, maxCompletionTokens: completionTokenBudget, sectionOutputBudget, maxTotalTokens: groqTpmBudgetApplies ? MAX_GROQ_TOTAL_TOKENS : null, estimatedTotalTokens: estimatedInputTokens + completionTokenBudget }));

    let response: Response | null = null;
    for (let networkAttempt = 0; networkAttempt < MAX_NETWORK_ATTEMPTS; networkAttempt++) {
      signal?.throwIfAborted();
      const requestTimeoutSignal = AbortSignal.timeout(requestTimeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, requestTimeoutSignal])
        : requestTimeoutSignal;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
          signal: requestSignal,
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        const timedOut = requestTimeoutSignal.aborted && !signal?.aborted;
        await recordProviderAttempt(input, {
          provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: null,
          errorType: timedOut ? "timeout" : "provider_unavailable",
          retryable: !signal?.aborted, attempt: networkAttempt + 1,
        });
        if (timedOut) {
          throw new Error(providerLabel + " " + groupName + " request timed out after " + requestTimeoutMs + "ms", { cause: error });
        }
        throw error;
      }
      const errorBody = response.ok ? "" : await response.clone().text().catch(() => "");
      const dailyLimit = providerName === "groq" && response.status === 429
        && /tokens?\s+per\s+day|\bTPD\b|daily[\s_-]*limit|limit[\s_-]*reached.*daily/i.test(errorBody);
      let malformedProviderOutput = false;
      if (response.status === 401 || response.status === 403) {
        markAssessmentProviderUnavailable(providerName as "groq" | "gemini" | "ollama", "auth_error");
      }
      if (response.status === 400) {
        try { malformedProviderOutput = (JSON.parse(errorBody) as { error?: { code?: unknown } }).error?.code === "json_validate_failed"; }
        catch { malformedProviderOutput = false; }
      }
      await recordProviderAttempt(input, {
        provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status,
        errorType: dailyLimit ? "capacity" : malformedProviderOutput ? "malformed_output" : response.ok ? "none" : providerErrorType(response.status),
        retryable: !response.ok && !dailyLimit && (response.status === 429 || response.status >= 500),
        attempt: networkAttempt + 1,
      });
      if (dailyLimit) {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 0, 0);
        if (process.env.NODE_ENV !== "test") {
          groqDailyCapUntil = tomorrow.getTime();
          markAssessmentProviderUnavailable("groq", "daily_capacity", tomorrow.getTime());
        }
        throw new Error("AI capacity reached for now, please try again later", { cause: new Error("GROQ_DAILY_CAP_REACHED") });
      }
      if (response.ok) break;
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || networkAttempt >= 2) break;
      await sleepImpl(Math.min(60_000, await providerRetryDelayMs(response, networkAttempt)), signal);
      signal?.throwIfAborted();
    }

    if (!response || !response.ok) {
      const detail = await response?.text().catch(() => "") ?? "";
      let providerError: { error?: { code?: unknown; message?: unknown; failed_generation?: unknown } } = {};
      try {
        providerError = JSON.parse(detail) as typeof providerError;
      } catch {
        // Preserve the original provider response below.
      }

      if (response?.status === 413) {
        if (process.env.NODE_ENV !== "test") groqCompletionBudgetScale = Math.max(0.25, groqCompletionBudgetScale * 0.5);
        throw new Error("GROQ_REQUEST_TOO_LARGE: provider rejected the request; it was not retried and future Groq completion budgets were reduced");
      }

      if (response?.status === 400 && providerError.error?.code === "json_validate_failed") {
        const message = typeof providerError.error.message === "string"
          ? providerError.error.message
          : "The provider rejected its generated JSON.";
        const failedGeneration = typeof providerError.error.failed_generation === "string"
          ? providerError.error.failed_generation.trim()
          : "";
        const diagnostic = failedGeneration
          ? " " + providerLabel + " returned failed_generation diagnostics; do not copy unsupported content."
          : " " + providerLabel + " supplied no failed_generation diagnostics.";

        if (responseMode === "json_schema" && strictSchemaRetries < 1) {
          strictSchemaRetries++;
          responseMode = "json_object";
          lastError = "" + providerLabel + " strict JSON-schema validation failed for " + groupName + ": " + message + "." + diagnostic
            + " Switch immediately to JSON-object mode and return one complete object matching the exact outputSchema. The application will enforce local Zod and section word-count validation.";
          continue;
        }

        if (responseMode === "json_object" && jsonObjectProviderRetries < 2) {
          jsonObjectProviderRetries++;
          if (jsonObjectProviderRetries === 2) {
            responseMode = "prompt_only";
            lastError = "" + providerLabel + " also rejected JSON-object mode for " + groupName + ": " + message + "." + diagnostic
              + " Omit response_format on the next request, return raw JSON only, and match every field in outputSchema.";
          } else {
            lastError = "" + providerLabel + " rejected JSON-object mode for " + groupName + ": " + message + "." + diagnostic
              + " Retry JSON-object mode with the exact outputSchema and a complete JSON object.";
          }
          continue;
        }

        if (responseMode === "prompt_only" && promptOnlyProviderRetries < 1) {
          promptOnlyProviderRetries++;
          lastError = "" + providerLabel + " rejected prompt-only JSON for " + groupName + ": " + message + "." + diagnostic
            + " Retry once with a complete raw JSON object matching outputSchema exactly.";
          continue;
        }

        throw new Error("json_validate_failed: " + providerLabel + " " + groupName + " assessment failed with HTTP 400 after bounded JSON recovery: " + detail.slice(0, 300));
      }

      throw new Error("" + providerLabel + " " + groupName + " assessment failed with HTTP " + (response?.status ?? "unknown")
        + (detail ? ": " + detail.slice(0, 300) : ""));
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    console.info(JSON.stringify({ provider: providerName, event: "response_usage", group: groupName, estimatedInputTokens, actualPromptTokens: payload.usage?.prompt_tokens ?? null, actualCompletionTokens: payload.usage?.completion_tokens ?? null, actualTotalTokens: payload.usage?.total_tokens ?? null }));
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1 });
      if (scheduleCorrection("The response contained no JSON content. Return one complete JSON object matching outputSchema.")) continue;
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1 });
      if (scheduleCorrection("The response was not valid JSON. Return raw JSON only, without markdown or surrounding prose.")) continue;
      break;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1 });
      const detail = responseMode === "json_object" || responseMode === "prompt_only"
        ? "The " + responseMode + " response failed local Zod validation: " + result.error.message + "."
        : "Strict structured output failed local Zod validation: " + result.error.message + ".";
      if (scheduleCorrection(detail + " Correct every reported field and return the complete schema object.")) continue;
      break;
    }

    const wordError = thresholdError(groupName, result.data);
    if (wordError) {
      if (scheduleCorrection(wordError + " Repair the exact field and preserve the evidence-bounded meaning.")) continue;
      break;
    }
    await input.saveCompletedSectionGroup?.(cacheGroupName, result.data);
    return result.data;
  }

  throw new Error("" + providerLabel + " " + groupName + " response failed Zod validation after one retry: " + lastError);
}

export class GroqClient implements GroqAssessmentClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly requestTimeoutMs: number;
  private readonly assessmentTimeoutMs: number;
  private readonly endpoint: string;
  private readonly providerName: string;

  constructor(
    apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_API,
    model = process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    fetchImpl: typeof fetch = fetch,
    sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep,
    requestTimeoutMs = GROQ_REQUEST_TIMEOUT_MS,
    assessmentTimeoutMs = GROQ_ASSESSMENT_TIMEOUT_MS,
    endpoint = "https://api.groq.com/openai/v1/chat/completions",
    providerName = "groq",
  ) {
    if (!apiKey) throw new Error(providerName === "gemini" ? "GEMINI_API_KEY is required" : providerName === "ollama" ? "OLLAMA_API_KEY is required" : "GROQ_API is required");
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("Groq request timeout must be a positive finite number");
    }
    if (!Number.isFinite(assessmentTimeoutMs) || assessmentTimeoutMs <= 0) {
      throw new Error("Groq assessment timeout must be a positive finite number");
    }
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.assessmentTimeoutMs = assessmentTimeoutMs;
    this.endpoint = endpoint;
    this.providerName = providerName;
  }
  async assess(input:GroqAssessmentInput, signal?:AbortSignal):Promise<ArAssessment>{
    if (this.providerName === "groq" && Date.now() < groqDailyCapUntil) {
      await recordProviderAttempt(input, { provider: "groq", model: this.model, status: null, errorType: "capacity", retryable: false, attempt: 0 });
      throw new Error("GROQ_DAILY_CAP_SKIPPED: daily token limit was already reached for this UTC day");
    }
    const deadlineController = new AbortController();
    const deadlineError = new Error("GROQ_ASSESSMENT_TIMEOUT");
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(deadlineError),
      this.assessmentTimeoutMs,
    );
    const assessmentSignal = signal
      ? AbortSignal.any([signal, deadlineController.signal])
      : deadlineController.signal;
    try {
      return await this.assessWithinDeadline(input, assessmentSignal);
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private async assessWithinDeadline(input:GroqAssessmentInput, signal?:AbortSignal):Promise<ArAssessment>{
    signal?.throwIfAborted();
    const promptInput: GroqAssessmentInput = {
      ...input,
      sonicDna: compactSonicDnaForGroq(input.sonicDna),
    };
    const tasks=[
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"narrative","Write the executive assessment, identity, strengths and risks.",NarrativeSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"positioning","Write evidence-bounded A&R positioning and commercial read.",PositioningSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"release","Write a grounded release recommendation and priorities.",ReleaseSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"evidence-score","Score only evidence-derivable dimensions. Always include the evidenceLabels array with at least one item; every item must include label, claim and source. Use only source-grounded labels. If no track-specific source supports a label, include a clearly separated INDUSTRY PRACTICE item with source industry_practice where appropriate; never fabricate track-specific evidence. Return the unscored human listening checklist. Every evidenceGaps item and every limitations item must contain at least 8 words. Every scorecard rationale must contain at least 25 words. In particular, scorecard.rhythmicConsistency.rationale needs at least 25 words even for a null score; state which uploaded-master timing evidence is missing in a complete sentence. Every humanListeningChecklist item must contain at least 5 words. Do not use fragments or short labels; write complete, specific sentences. If the correction field identifies a word-count failure, repair that exact field while preserving the evidence-bounded meaning.",EvidenceScoreSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"production","Give actionable production and arrangement guidance. Separate lane-general craft as INDUSTRY PRACTICE.",ProductionSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"comparables","Provide inferred lane descriptors and reference-search criteria to verify; do not invent named artists or tracks.",ComparableSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"promotion","Build a staged promotion plan, general pitching angles, content concepts and playlist categories only. Each playlist category must be a descriptive phrase of at least three words. Include INDUSTRY PRACTICE separately.",PromotionSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"label-fit","Describe category-level partner fit and evidence criteria; no claims of label interest. Include INDUSTRY PRACTICE separately.",LabelFitSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"timeline","Build actionable 30/60/90-day steps without inventing dates, budgets or targets.",TimelineSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName)
    ];
    const groups:unknown[]=new Array(tasks.length);let cursor=0;
    const settled=await Promise.allSettled(Array.from({length:1},async()=>{while(cursor<tasks.length){const index=cursor++;groups[index]=await tasks[index]();}}));
    const failed=settled.find(result=>result.status==="rejected");
    if(failed&&failed.status==="rejected")throw failed.reason;
    const assembled=Object.assign({},...groups) as z.infer<typeof AssessmentSchema>;
    const dna=input.sonicDna;
    const audioMaster=Boolean(dna && dna.provenance==="uploaded_audio_master");
    const commercial=input.evidence.commercialEvidence;
    const hasCommercialEvidence=Boolean(commercial && typeof commercial==="object" && (commercial as Record<string,unknown>).verified===true && typeof (commercial as Record<string,unknown>).source==="string" && typeof (commercial as Record<string,unknown>).reportingPeriod==="string");
    if(!hasCommercialEvidence){assembled.commercialRead.marketability="undetermined";assembled.commercialRead.rationale="No verified commercial-performance source was included in this assessment. The supplied metadata and Sonic DNA do not establish listener demand, streams, sales, revenue, playlist conversion, demographic reach or campaign outcomes. Marketability remains undetermined until source-attributed audience or campaign measurements with a defined reporting period and method are provided.";}
    assembled.scorecard.dynamicRangeLoudness={score:null,rationale:"RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied, so technical delivery readiness remains unscored for this recording."};
    if(!audioMaster){
      assembled.scorecard.rhythmicConsistency={score:null,rationale:"Rhythmic consistency requires analysis of an uploaded audio master. Provider metadata alone cannot establish timing stability or groove consistency, so this dimension remains unscored for this specific recording."};
    }
    const metadataKeys=["artist","title","isrc","album","releaseDate","label"];
    const hasMetadataEvidence=metadataKeys.some(key=>typeof input.evidence[key]==="string" && String(input.evidence[key]).trim().length>0);
    if(!hasMetadataEvidence){
      assembled.scorecard.metadataCompleteness={score:null,rationale:"No artist, title, ISRC, album, release date or label evidence was supplied. Metadata completeness therefore remains unscored until source-attributed identity fields and their authoritative source references are available for this assessment."};
    }
    const releaseKeys=["rightsStatus","deliveryStatus","releaseStatus","masterApproved"];
    const hasReleaseEvidence=releaseKeys.some(key=>typeof input.evidence[key]==="string" && String(input.evidence[key]).trim().length>0 || input.evidence[key]===true);
    if(!hasReleaseEvidence){
      assembled.scorecard.releaseReadiness={score:null,rationale:"No rights, delivery, release-status or master-approval evidence was supplied. Release readiness remains unscored until source-attributed release execution, rights clearance, delivery confirmation and final master approval fields are available for this specific release."};
    }
    if(typeof dna?.bpm!=="number"){
      assembled.scorecard.tempoLaneFit={score:null,rationale:"No verified tempo measurement is available in the supplied evidence. Tempo and lane fit therefore remain unscored until a suitable source measurement for this specific recording is supplied."};
    }
    const combined=AssessmentSchema.safeParse(assembled);
    if(!combined.success)throw new Error("Combined Groq assessment failed Zod validation: "+combined.error.message);
    return sanitizeAssessmentForEvidence(combined.data, dna as Record<string, unknown> | null, input.evidence);
  }
}
export { AssessmentSchema, EvidenceLabelSchema };


/** Gemini uses Google's OpenAI-compatible endpoint and JSON-object mode.
 * Every response still passes the same local Zod and evidence guardrails. */
export class GeminiClient extends GroqClient {
  constructor(
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    fetchImpl: typeof fetch = fetch,
    sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep,
    requestTimeoutMs = GROQ_REQUEST_TIMEOUT_MS,
    assessmentTimeoutMs = GEMINI_ASSESSMENT_TIMEOUT_MS,
  ) {
    super(apiKey, model, fetchImpl, sleepImpl, requestTimeoutMs, assessmentTimeoutMs,
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini");
  }
}


/** Ollama Cloud adapter. JSON mode is followed by local Zod and evidence validation. */
export class OllamaClient extends GroqClient {
  constructor(
    apiKey = process.env.OLLAMA_API_KEY,
    model = process.env.OLLAMA_MODEL ?? "gemma4:31b",
    fetchImpl: typeof fetch = fetch,
    sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep,
    requestTimeoutMs = GROQ_REQUEST_TIMEOUT_MS,
    assessmentTimeoutMs = OLLAMA_ASSESSMENT_TIMEOUT_MS,
  ) {
    super(apiKey, model, fetchImpl, sleepImpl, requestTimeoutMs, assessmentTimeoutMs,
      "https://ollama.com/v1/chat/completions", "ollama");
  }
}
