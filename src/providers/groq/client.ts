import { z } from "zod";
import { sanitizeAssessmentForEvidence } from "../../reports/evidence-guardrails.js";
import { sharedGroqTokenLimiter } from "../token-per-minute-limiter.js";
import { markAssessmentProviderUnavailable } from "../provider-policy.js";

export const GROQ_PROMPT_VERSION = "audit-ar-v9-positioning-reliability-2026-11-24";
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
    tonalConsensus: ScoreSchema.optional(),
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

const GenerationProvenanceSchema = z.object({
  provider: z.enum(["groq", "gemini", "ollama"]),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  fieldGroups: z.record(z.string(), z.enum(["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"])),
}).strict();
const AssessmentSchema = NarrativeSchema.extend(PositioningSchema.shape).extend(ReleaseSchema.shape)
  .extend(EvidenceScoreSchema.shape).extend(ProductionSchema.shape).extend(ComparableSchema.shape)
  .extend(PromotionSchema.shape).extend(LabelFitSchema.shape).extend(TimelineSchema.shape)
  .extend({ generationProvenance: GenerationProvenanceSchema });
export type ArAssessment = z.infer<typeof AssessmentSchema>;

export interface ProviderAttemptDiagnostic {
  provider: "groq" | "gemini" | "ollama";
  model: string;
  status: number | null;
  errorType: "none" | "capacity" | "auth" | "malformed_output" | "timeout" | "provider_unavailable" | "provider_error";
  retryable: boolean;
  attempt: number;
  group?: string;
  failureKind?: "empty_content" | "invalid_json" | "schema_violation" | "threshold_violation" | "prompt_budget_exceeded";
  validationIssues?: Array<{ code: string; path: string[] }>;
  validationField?: string;
  validationRule?: "minimum_word_count" | "minimum_item_count";
  minimumWords?: number;
  actualWords?: number;
  minimumItems?: number;
  actualItems?: number;
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
  "You are the A&R intelligence analyst for a private music-audit service. Use supplied evidence only. Never invent streams, sales, revenue, playlist data, named playlists, curators, demographics, market size, audience metrics, label interest, placements or external facts.",
  "Evidence classes are distinct: OBSERVED=measured directly from uploaded audio master; RECOGNIZED=claim from one named external/DSP source; RECONCILED=at least two independent named providers agree without conflict; INFERRED=labelled hypothesis (including genre/lane/positioning/comparables); INDUSTRY PRACTICE=general craft guidance, not a fifth evidence tier or track fact. Every label names its actual source: groq_assessment for INFERRED, industry_practice for INDUSTRY PRACTICE.",
  "Keep provider-backed genre labels exact; separate region/city-scene tags; retain unmapped tags as unresolved. Null/abstained primary genre means no definitive genre or confirmed A&R lane. Tempo is at most 15% of genre score and never establishes genre alone.",
  "Tempo is usable only when tempoConfidence >=0.5 and a confirmed tempo is present. Missing/low confidence means do not repeat BPM, infer speed/energy, score tempoLaneFit/rhythmicConsistency or use it in recommendations. If candidate/window/independent-estimator evidence exists while confirmed tempo is null, report provisional evidence and its consensus limitation, not absence of analysis.",
  "Key/mode and tempo are CONFIRMED only from supplied voting/window-consensus-stabilized results. If confirmed values are null, preserve candidates/disagreement as provisional and never promote a candidate.",
  "Provisional mood labels are heuristic signal descriptors, not calibrated probabilities, listener emotion or demand. Provisional energy is a low/moderate/high heuristic with its score out of 100, never a probability.",
  "Use vocalFeatures only when status=analyzed; report measured activity/pitch with limitations. Otherwise abstain; never infer voice presence, delivery, layering or lyrics. Discuss verse/chorus/bridge/intro/outro only when explicit track-structure analysis supplies boundaries.",
  "Use reconciled identity, field provenance, catalogSources and provider records. Name a provider only if it returned a record; preserve ISRC conflicts and ambiguous matches. DSP/catalog links are not audio: never claim OBSERVED audio measurements or invent audio analysis from a link. No external stem/separation/render workers.",
  "Strengths, risks and actions cite supplied sonic, vocal, genre and catalog evidence. Distinguish unavailable analysis from a calculated low-confidence candidate; do not replace specific evidence/conflicts with generic prose. Recommendations are actionable and grounded in evidence or separately labelled INDUSTRY PRACTICE. Never invent artist/track comparables; give verification criteria.",
  "Absent verified commercial-performance evidence, marketability is undetermined; never infer demand from genre, tempo, catalog popularity or metadata. Release date is DETERMINED only from supplied verified date evidence; preserve PRE_RELEASE versus POST_RELEASE. Market verdict remains PROPOSED unless deterministic evidence rules establish otherwise.",
  "Null score means insufficient evidence. RMS spread/dBFS are descriptive, not mastering readiness; keep delivery readiness unscored without destination-specific integrated loudness, range and true-peak targets. Near -11 LUFS alone is not a fault; never recommend loudness changes without measured fault and target. Centroid <=2,000 Hz is not bright. Mono is a compatibility risk to check, not proof of incompatibility.",
  "Do not score taste: hook, originality, production quality, replay value and lane clarity belong only in the unscored human listening checklist, with a distinct first-listen question for each. scorecard.rhythmicConsistency.rationale must contain at least 25 words even when null and explain missing timing evidence in a complete sentence.",
  "Return JSON only as one complete object; obey schema and local word-count requirements without repeated boilerplate."
].join(" ");

const NARRATIVE_SYSTEM_PROMPT = [
  "Use supplied evidence only; never invent streams, sales, revenue, playlists, curators, demographics, audience metrics, label interest, placements or external facts.",
  "Labels: OBSERVED=uploaded-master measurement; RECOGNIZED=one provider; RECONCILED=2+ independent agreeing providers; INFERRED=groq_assessment hypothesis; INDUSTRY PRACTICE=industry_practice guidance, never a track fact. Name only providers with returned records.",
  "Preserve exact provider genre labels and separate scene tags; null primary genre means no confirmed lane. Tempo contributes <=15% to genre scoring and never proves genre.",
  "Use BPM only when confirmed at confidence >=0.5; otherwise omit BPM, speed/energy inference and tempo scoring. Unconfirmed candidates/windows stay provisional.",
  "Key/mode are CONFIRMED only by supplied voting/window-consensus-stabilized results; null/disagreement stays provisional. Mood/energy are heuristics, not probabilities, listener emotion or demand; use only supplied energy label and score/100.",
  "Use vocals only when status=analyzed; otherwise infer no voice, delivery, layering or lyrics. Sections require explicit boundaries.",
  "Use reconciled identity, provenance, catalogSources and provider records; preserve ISRC conflicts/ambiguity. DSP/catalog links are not audio; never claim OBSERVED audio from links. No external stem, separation or render workers.",
  "Ground strengths, risks and actions in supplied sonic, vocal, genre and catalog facts. Label general guidance INDUSTRY PRACTICE; do not invent comparables.",
  "Return at least 3 distinct evidence-grounded strengths and at least 2 distinct evidence-grounded risks; each item must be a complete, specific statement tied to a supplied fact or an explicitly stated evidence limitation. Do not pad counts with repeated or generic claims.",
  "Without verified commercial performance, marketability is undetermined. Release date is DETERMINED only from verified evidence; preserve PRE_RELEASE versus POST_RELEASE. Market verdict stays PROPOSED unless deterministic rules establish otherwise.",
  "Do not score hook, originality, production quality, replay value or lane clarity; keep them in the unscored human-listening checklist. Return JSON only; obey schema/word limits."
 ].join(" ");

const POSITIONING_INSTRUCTIONS = "For aAndRPositioning.rationale and commercialRead.rationale, each must contain at least 40 words (>= 40 words each). Give one concise, evidence-bounded rationale per field; cite supplied evidence or explicitly name the evidence gap. Never pad, repeat boilerplate, or infer commercial demand without verified commercial telemetry. Keep marketability undetermined when such telemetry is absent.";

const PRODUCTION_SYSTEM_PROMPT = NARRATIVE_SYSTEM_PROMPT + " RMS/dBFS do not prove mastering readiness; do not recommend loudness changes without a measured fault and target. Centroid <=2,000 Hz is not bright; mono is a risk to check, not proof of incompatibility.";

const EVIDENCE_SCORE_SYSTEM_PROMPT = [
  "Use supplied facts only; never invent streams, sales, playlists, curators, audience metrics, label interest, placements or external facts.",
  "Always include the evidenceLabels array; each item has label, claim and actual source. OBSERVED=uploaded-master measurement; RECOGNIZED=one provider; RECONCILED=2+ agreeing independent providers; INFERRED=groq_assessment hypothesis; INDUSTRY PRACTICE=industry_practice guidance, not track fact.",
  "DSP/catalog links are not audio. Without uploaded-master provenance, do not claim OBSERVED audio or infer BPM, key, vocals, lyrics, arrangement or sections. No external stem/separation/render workers.",
  "Tempo/key are CONFIRMED only by voting/window-consensus-stabilized results; null/candidates stay provisional and disagreement visible. Missing tempo or confidence <0.5 means no BPM, tempoLaneFit or rhythmicConsistency score. Tempo is <=15% of genre scoring; preserve provider genres and separate scene tags.",
  "Mood/energy are heuristics, not probability, emotion or demand. Use vocals only when analyzed; sections need explicit boundaries. Preserve provider names, identity conflicts, ISRC ambiguity and provenance; name only providers with returned records.",
  "Without verified commercial evidence, marketability is undetermined. Release date DETERMINED only from verified evidence; preserve PRE_RELEASE/POST_RELEASE. Market verdict PROPOSED unless deterministic rules establish otherwise; never infer demand from genre, tempo, popularity or metadata.",
  "Each evidenceGaps and limitations item must contain at least 8 words; null scores mean insufficient evidence. Every scorecard rationale, including tempoLaneFit, rhythmicConsistency, dynamicRangeLoudness, metadataCompleteness and releaseReadiness, must contain at least 25 words even when its score is null; explain the evidence, limitation or reason for abstention without inventing measurements. RMS/dBFS do not prove mastering readiness; no delivery score without destination targets or loudness change without measured fault/target. Centroid <=2,000 Hz is not bright; mono is risk, not incompatibility.",
  "Do not score hook, originality, production quality, replay value or lane clarity; keep them unscored with distinct listening checks. scorecard.rhythmicConsistency.rationale must contain at least 25 words even when null. Separate track evidence from INDUSTRY PRACTICE. JSON only; local Zod/word-count validation is authoritative."
].join(" ");

function words(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }
function safeThresholdDiagnostic(group: string, value: unknown, message: string): Pick<ProviderAttemptDiagnostic, "validationField" | "validationRule" | "minimumWords" | "actualWords" | "minimumItems" | "actualItems"> {
  const d = value as Record<string, any>;
  const wordMatch = message.match(/^(.+?) must contain at least ([0-9]+) words/);
  const itemMatch = message.match(/^(.+?) must contain at least ([0-9]+) items/);
  const match = wordMatch ?? itemMatch;
  const label = match?.[1] ?? "unknown";
  const minimum = Number(match?.[2] ?? 0);
  const fieldMap: Record<string, string> = {
    "positioning rationale": "aAndRPositioning.rationale",
    "commercial rationale": "commercialRead.rationale",
    executiveSummary: "executiveSummary", creativeIdentity: "creativeIdentity",
    recommendation: "releaseStrategy.recommendation",
    productionArrangementGuidance: "productionArrangementGuidance",
    industryPractice: group === "production" ? "industryPractice" : group === "promotion" ? "promotionPlan.industryPractice" : "labelPartnerFit.industryPractice",
    laneHypothesis: "laneHypothesis", verificationMethod: "verificationMethod",
    preRelease: "promotionPlan.preRelease", releaseWindow: "promotionPlan.releaseWindow", postRelease: "promotionPlan.postRelease",
    partnerProfile: "labelPartnerFit.partnerProfile", diligenceBeforeContact: "labelPartnerFit.diligenceBeforeContact",
    days30: "executionPlan.days30", days60: "executionPlan.days60", days90: "executionPlan.days90",
  };
  const validationField = fieldMap[label] ?? label;
  const actual = validationField.replace(/\[([0-9]+)\]/g, ".$1").split(".").filter(Boolean).reduce((current: any, key) => current?.[/^[0-9]+$/.test(key) ? Number(key) : key], d);
  if (itemMatch) return { validationField, validationRule: "minimum_item_count", minimumItems: minimum, actualItems: Array.isArray(actual) ? actual.length : 0 };
  return { validationField, validationRule: "minimum_word_count", minimumWords: minimum, actualWords: typeof actual === "string" ? words(actual) : 0 };
}
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
  if (group === "production") {
    // Production guidance is derived from the uploaded-master Sonic DNA
    // projection. Catalog identity and commercial records are irrelevant here.
    return compactPromptValue({
      auditType: evidence.auditType,
      evidenceClass: evidence.evidenceClass,
      fixture: evidence.fixture,
    }) as Record<string, unknown>;
  }
  if (["promotion", "comparables", "label-fit", "timeline"].includes(group)) {
    // These modules need only their task-specific release/genre context. The
    // full 12-field provider provenance and identity reconciliation are used
    // by narrative and evidence-score, not repeated across every section.
    const keys: Record<string, string[]> = {
      promotion: ["auditType", "artist", "title", "releaseDate", "sourceProviders", "genres", "genreClassification", "releaseStatus", "evidenceClass", "fixture"],
      comparables: ["auditType", "genres", "genreClassification", "sourceProviders", "evidenceClass", "fixture"],
      "label-fit": ["auditType", "genres", "genreClassification", "sourceProviders", "rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved", "evidenceClass", "fixture"],
      timeline: ["auditType", "artist", "title", "releaseDate", "rightsStatus", "deliveryStatus", "releaseStatus", "masterApproved", "evidenceClass", "fixture"],
    };
    const selected = Object.fromEntries(keys[group].filter(key => evidence[key] !== undefined)
      .map(key => [key, evidence[key]]));
    return compactEvidenceScoreValue(selected, 0, 48, 3) as Record<string, unknown>;
  }
  const allowed = new Set([...common, ...(groupFields[group] ?? [])]);
  // Evidence-score already receives canonical identity and source provenance.
  // Avoid repeating display-only identity fields and upload metadata in scoring.
  const evidenceScoreOmissions = new Set([
    "artist", "title", "album", "releaseDate", "label", "isrc", "upc",
    "masterAudio", "metadataSourcesChecked", "fixture", "catalogSources",
    "sourceCombination", "genres",
  ]);
  const projected = Object.fromEntries(Object.entries(evidence).filter(([key]) =>
    allowed.has(key) && !(group === "evidence-score" && evidenceScoreOmissions.has(key))
  ));

  // Provider provenance often contains verbose raw response descriptions.
  // Keep the source/status/confidence facts for every field, not duplicated
  // free-form payload text that can crowd out the actual assessment request.
  const provenance = projected.fieldProvenance;
  if (provenance && typeof provenance === "object" && !Array.isArray(provenance)) {
    projected.fieldProvenance = Object.fromEntries(
      Object.entries(provenance as Record<string, unknown>).slice(0, 12).map(([field, raw]) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [field, compactPromptValue(raw)];
        const record = raw as Record<string, unknown>;
        const retained = ["source", "provider", "status", "confidence", "evidenceClass", "value", "normalizedValue", "matchStatus"];
        return [field, Object.fromEntries(retained.filter((key) => record[key] !== undefined)
          .map((key) => [key, compactPromptValue(record[key])]))];
      }),
    );
  }

  // Preserve reconciliation outcomes and conflicts, but bound optional provider
  // commentary. Identity values and source names remain available to the model.
  for (const key of ["identity", "reconciliation", "genreClassification", "masterAudio", "sourceCombination"]) {
    if (projected[key] !== undefined) projected[key] = compactPromptValue(projected[key]);
  }

  if (group === "evidence-score") {
    // The normalized provenance/reconciliation fields above are the canonical
    // evidence-score inputs. These duplicate summaries are already represented
    // there and need not be serialized a second time.
    delete projected.genres;
    delete projected.catalogSources;
    delete projected.sourceCombination;
  } else if (["positioning", "narrative"].includes(group)) {
    // Provider combinations and masterAudio metadata are already represented by
    // sourceProviders, normalized identity and field provenance.
    delete projected.sourceCombination;
    if (["narrative", "promotion"].includes(group)) delete projected.masterAudio;
  }
  if (group === "narrative" && Array.isArray(projected.catalogSources)) {
    projected.catalogSources = (projected.catalogSources as unknown[]).map(source => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return source;
      const record = source as Record<string, unknown>;
      return Object.fromEntries(["platform", "status", "provider", "source"].filter(key => record[key] !== undefined)
        .map(key => [key, record[key]]));
    });
  }
  if (["evidence-score", "narrative", "positioning", "release", "production", "promotion"].includes(group)) {
    // Keep source/provenance facts; only evidence-score drops duplicate summaries.
    if (group === "evidence-score") {
      delete projected.genres;
      delete projected.catalogSources;
      delete projected.sourceCombination;
    }
    // Narrative receives the same bounded string/array envelope as evidence-score;
    // source identities and normalized values above remain intact.
    const compacted = compactEvidenceScoreValue(projected, 0, ["evidence-score", "production", "narrative"].includes(group) ? 48 : 72, ["evidence-score", "production", "narrative"].includes(group) ? 2 : 3) as Record<string, unknown>;
    if (compacted.fieldProvenance && typeof compacted.fieldProvenance === "object") {
      compacted.fieldProvenance = Object.fromEntries(Object.entries(compacted.fieldProvenance as Record<string, unknown>).slice(0, 12));
    }
    return compacted;
  }
  return compactPromptValue(projected) as Record<string, unknown>;
}

function compactPromptValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && value.length > 200 ? value.slice(0, 200) + " [truncated]" : value;
  }
  const sample = (items: unknown[], limit: number): unknown[] => {
    if (items.length <= limit) return items;
    if (limit <= 1) return [items[0]];
    // Evenly retain the full timeline, including its first and final observations.
    return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
  };
  if (depth >= 4) {
    if (Array.isArray(value)) return sample(value, 4).filter((item) => item === null || typeof item !== "object");
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 10)
      .filter(([, item]) => item === null || typeof item !== "object"));
  }
  if (Array.isArray(value)) return sample(value, 4).map((item) => compactPromptValue(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>);
  const scalarEntries = entries.filter(([, item]) => item === null || typeof item !== "object");
  const nestedEntries = entries.filter(([, item]) => item !== null && typeof item === "object");
  const selectedEntries = [
    ...scalarEntries.slice(0, 20),
    ...nestedEntries.slice(0, Math.max(0, 20 - Math.min(20, scalarEntries.length))),
  ];
  return Object.fromEntries(selectedEntries.map(([key, item]) => [key, compactPromptValue(item, depth + 1)]));
}

function compactEvidenceScoreValue(value: unknown, depth = 0, stringLimit = 112, arrayLimit = 4, fieldName = ""): unknown {
  const descriptiveField = /^(detail|rawPayload|description|reason|notes|commentary|warning|warnings)$/i.test(fieldName);
  const maxStringLength = fieldName === "limitations" ? 72 : descriptiveField ? Math.min(stringLimit, 32) : stringLimit;
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && value.length > maxStringLength ? value.slice(0, maxStringLength) + "…" : value;
  }
  const sample = (items: unknown[], limit: number): unknown[] => items.length <= limit ? items
    : Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
  if (Array.isArray(value)) {
    const limit = /^(sourceProviders|genres|catalogSources|matchedFields)$/i.test(fieldName) ? 12
      : /^(segments|sections)$/i.test(fieldName) ? 4 : arrayLimit;
    return sample(value, limit).map(item => compactEvidenceScoreValue(item, depth + 1, stringLimit, arrayLimit, fieldName));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth >= 4) return Object.fromEntries(entries.filter(([, item]) => item === null || typeof item !== "object")
    .slice(0, 12).map(([key, item]) => [key, compactEvidenceScoreValue(item, depth + 1, stringLimit, arrayLimit, key)]));
  return Object.fromEntries(entries.slice(0, depth === 0 ? 32 : 16)
    .map(([key, item]) => [key, compactEvidenceScoreValue(item, depth + 1, stringLimit, arrayLimit, key)]));
}

function compactStructuredSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactStructuredSchema);
  if (!schema || typeof schema !== "object") return schema;
  // Local Zod validation remains authoritative for numeric and length bounds.
  const omitted = new Set(["$schema", "title", "description", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]);
  return Object.fromEntries(Object.entries(schema as Record<string, unknown>)
    .filter(([key]) => !omitted.has(key))
    .map(([key, value]) => [key, compactStructuredSchema(value)]));
}

function compactSonicDnaForGroq(sonicDna: Record<string, unknown> | null, group: string): Record<string, unknown> | null {
  if (!sonicDna) return null;

  // Keep scalar measurements and provenance, but send nested feature families
  // only to the section that can use them. This avoids retransmitting the full
  // audio-analysis object nine times without discarding report evidence.
  const common = new Set([
    "provenance", "evidenceClass", "analysisVersion", "sourceProviders",
    "confidence", "warnings", "bpm", "tempoConfidence", "key", "mode",
    "moodTags", "genreTags", "genreContext", "limitations", "keyCandidates", "genreClassification",
    "tonalResolution",
  ]);
  const featureFamilies: Record<string, string[]> = {
    narrative: ["acousticFeatureProfile", "vocalFeatures"],
    positioning: ["acousticFeatureProfile", "vocalFeatures"],
    release: ["acousticFeatureProfile", "rhythmFeatures", "harmonicFeatures"],
    "evidence-score": ["acousticFeatureProfile", "vocalFeatures", "vocalArrangementAnalysis", "rhythmFeatures", "harmonicFeatures", "dynamicRangeDb", "rmsLevelDbfs", "rmsEnergy", "loudnessLufs", "loudnessRangeLu", "truePeakDbfs", "spectralCentroidHz", "spectralBandwidthHz", "spectralRolloffHz", "zeroCrossingRate", "sampleRate", "channels", "durationSeconds", "loudnessFeatures", "audioProperties"],
    production: ["acousticFeatureProfile", "vocalFeatures", "vocalArrangementAnalysis", "rhythmFeatures", "harmonicFeatures", "dynamicRangeDb", "rmsLevelDbfs", "rmsEnergy", "loudnessLufs", "loudnessRangeLu", "truePeakDbfs", "spectralCentroidHz", "spectralBandwidthHz", "spectralRolloffHz", "zeroCrossingRate", "sampleRate", "channels", "durationSeconds", "loudnessFeatures", "audioProperties"],
    comparables: [],
    promotion: ["acousticFeatureProfile"],
    "label-fit": [],
    timeline: [],
  };
  const allowed = new Set([...common, ...(featureFamilies[group] ?? [])]);
  const compact = Object.fromEntries(Object.entries(sonicDna).filter(([key, value]) =>
    allowed.has(key) || (!["narrative", "positioning", "release", "promotion"].includes(group) && (value === null || typeof value !== "object"))
  )) as Record<string, unknown>;

  const rhythm = compact.rhythmFeatures;
  if (rhythm && typeof rhythm === "object" && !Array.isArray(rhythm)) {
    const summary = { ...(rhythm as Record<string, unknown>) };
    delete summary.onsetEnvelope;
    delete summary.beatTimesSeconds;
    delete summary.downbeatCandidateTimesSeconds;
    compact.rhythmFeatures = summary;
  }

  const harmonic = compact.harmonicFeatures;
  if (harmonic && typeof harmonic === "object" && !Array.isArray(harmonic)) {
    const summary = { ...(harmonic as Record<string, unknown>) };
    delete summary.segmentChroma;
    compact.harmonicFeatures = summary;
  }

  const compacted = (["evidence-score", "narrative", "positioning", "production", "promotion"].includes(group)
    ? compactEvidenceScoreValue(compact, 0, group === "production" ? 40 : group === "narrative" ? 48 : 72, ["evidence-score", "production", "narrative"].includes(group) ? 2 : 3)
    : compactPromptValue(compact)) as Record<string, unknown>;
  // Keep every bounded feature family that this section explicitly consumes,
  // even when numerous scalar telemetry fields precede it in the source object.
  for (const key of [...common, ...(featureFamilies[group] ?? [])]) {
    const value = compact[key];
    if (value !== undefined) compacted[key] = ["evidence-score", "narrative", "positioning", "production", "promotion"].includes(group)
      ? compactEvidenceScoreValue(value, 0, group === "production" ? 40 : group === "narrative" ? 48 : 72, group === "narrative" ? 3 : group === "evidence-score" ? 4 : 3)
      : compactPromptValue(value);
  }
  if (["evidence-score", "production"].includes(group) && compacted.vocalArrangementAnalysis && typeof compacted.vocalArrangementAnalysis === "object" && !Array.isArray(compacted.vocalArrangementAnalysis)) {
    // Vocal scalar measurements and provenance live in vocalFeatures. Keep a compact
    // arrangement summary, not a second copy of the full 128-window timeline.
    const arrangement = compacted.vocalArrangementAnalysis as Record<string, unknown>;
    const rawSegments = Array.isArray(arrangement.segments) ? arrangement.segments : [];
    const rawSections = Array.isArray(arrangement.sections) ? arrangement.sections : [];
    const selectFour = (items: unknown[]) => items.length <= 4 ? items : [items[0], items[Math.round((items.length - 1) / 3)], items[Math.round(2 * (items.length - 1) / 3)], items[items.length - 1]];
    const compactItems = (items: unknown[], fields: string[]) => selectFour(items).map(segment => {
      if (!segment || typeof segment !== "object" || Array.isArray(segment)) return null;
      const item = segment as Record<string, unknown>;
      return Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    }).filter(Boolean);
    compacted.vocalArrangementAnalysis = {
      status: arrangement.status,
      method: arrangement.method,
      model: arrangement.model && typeof arrangement.model === "object" && !Array.isArray(arrangement.model)
        ? Object.fromEntries(["name", "version"].filter(key => (arrangement.model as Record<string, unknown>)[key] !== undefined)
          .map(key => [key, (arrangement.model as Record<string, unknown>)[key]])) : undefined,
      segmentCount: rawSegments.length,
      ...(Array.isArray(arrangement.segments) ? { segments: compactItems(rawSegments, ["startSeconds", "endSeconds", "role", "confidence"]) } : {}),
      ...(Array.isArray(arrangement.sections) ? { sections: compactItems(rawSections, ["label", "startSeconds", "endSeconds", "provisional"]) } : {}),
    };
  }
  if (["narrative", "positioning", "release", "evidence-score", "production", "promotion"].includes(group)) {
    // The narrative needs the complete acoustic descriptor summary, not the
    // 128-window raw summary series. Median/p10/p90 preserve measured spread;
    // vocal intervals retain representative first/middle/last observations.
    const profile = compacted.acousticFeatureProfile;
    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      const raw = profile as Record<string, unknown>;
      const rawProvenance = raw.provenance && typeof raw.provenance === "object" && !Array.isArray(raw.provenance)
        ? raw.provenance as Record<string, unknown> : {};
      const provenanceKeys = [
        "featureVersion", "algorithm", "sourceSampleRateHz", "analysisSampleRateHz",
        "analysisResampling", "channels", "durationSeconds", "windowCount", "aggregation",
      ];
      compacted.acousticFeatureProfile = {
        status: raw.status,
        provenance: Object.fromEntries(provenanceKeys.filter(key => rawProvenance[key] !== undefined)
          .map(key => [key, rawProvenance[key]])),
        descriptors: raw.descriptors && typeof raw.descriptors === "object" && !Array.isArray(raw.descriptors)
          ? Object.fromEntries(Object.entries(raw.descriptors as Record<string, unknown>).map(([name, descriptor]) => {
            if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return [name, compactPromptValue(descriptor)];
            const measured = descriptor as Record<string, unknown>;
            return [name, Object.fromEntries(["median", "p10", "p90", "unit"].filter(key => measured[key] !== undefined)
              .map(key => [key, measured[key]]))];
          }))
          : compactPromptValue(raw.descriptors),
        predictions: raw.predictions && typeof raw.predictions === "object" && !Array.isArray(raw.predictions)
          ? Object.fromEntries(Object.entries(raw.predictions as Record<string, unknown>).map(([name, prediction]) => {
            if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) return [name, compactPromptValue(prediction)];
            const result = { ...(prediction as Record<string, unknown>) };
            delete result.method;
            delete result.probability;
            return [name, compactPromptValue(result)];
          }))
          : compactPromptValue(raw.predictions),
        abstentionReasons: compactEvidenceScoreValue(raw.abstentionReasons, 0, 72, 3),
      };
    }

    const vocal = compacted.vocalFeatures;
    if (vocal && typeof vocal === "object" && !Array.isArray(vocal)) {
      const raw = vocal as Record<string, unknown>;
      const scalarFields = Object.entries(raw).filter(([, value]) =>
        value === null || ["string", "number", "boolean"].includes(typeof value));
      const vocalProjection: Record<string, unknown> = Object.fromEntries(scalarFields);
      if (raw.model && typeof raw.model === "object" && !Array.isArray(raw.model)) {
        const model = raw.model as Record<string, unknown>;
        vocalProjection.model = Object.fromEntries(["name", "version"].filter(key => model[key] !== undefined)
          .map(key => [key, model[key]]));
      }
      for (const key of (["positioning", "evidence-score"].includes(group) ? ["limitations"] : ["activitySegments", "pitchSegments", "limitations"])) {
        if (raw[key] === undefined) continue;
        if (group === "narrative" && (key === "activitySegments" || key === "pitchSegments") && Array.isArray(raw[key])) {
          const entries = raw[key] as unknown[];
          const selected = entries.length <= 3 ? entries : [entries[0], entries[Math.floor((entries.length - 1) / 2)], entries[entries.length - 1]];
          const fields = key === "activitySegments"
            ? ["startSeconds", "endSeconds", "meanLevelDbfs", "peakLevelDbfs"]
            : ["startSeconds", "endSeconds", "medianHz", "confidence", "method"];
          vocalProjection[key] = selected.map(entry => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const item = entry as Record<string, unknown>;
            return Object.fromEntries(fields.filter(field => item[field] !== undefined).map(field => [field, item[field]]));
          }).filter(Boolean);
        } else {
          vocalProjection[key] = compactEvidenceScoreValue(raw[key], 0, 72, 3);
        }
      }
      compacted.vocalFeatures = vocalProjection;
    }
  }
  return compacted;
}

function compactCatalogMetadataForGroup(
  value: Record<string, unknown> | null | undefined,
  group: string,
  evidence: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!value || !["narrative", "positioning", "evidence-score", "label-fit"].includes(group)) return null;
  if (["evidence-score", "narrative", "positioning"].includes(group)) {
    const hasNormalizedCatalogEvidence = Boolean(
      evidence.identity && typeof evidence.identity === "object"
      && evidence.fieldProvenance && typeof evidence.fieldProvenance === "object"
      && evidence.reconciliation && typeof evidence.reconciliation === "object"
      && Array.isArray(evidence.sourceProviders) && evidence.sourceProviders.length > 0
    );
    // Prefer the canonical normalized catalog evidence when it is complete.
    // Narrative and evidence-score both receive these source facts through the
    // evidence projection; sending provider records again only duplicates large
    // catalog payloads. Keep provider records for sparse inputs.
    if (hasNormalizedCatalogEvidence) return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // Retain a bounded set of named provider records; long descriptions/raw
  // responses are already represented by normalized evidence and provenance.
  return Object.fromEntries(Object.entries(value).slice(0, 4)
    .map(([provider, record]) => [provider, ["evidence-score", "narrative", "positioning", "release"].includes(group) ? compactEvidenceScoreValue(record, 0, 72, 3) : compactPromptValue(record)])) as Record<string, unknown>;
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
  const rawOutputSchema = z.toJSONSchema(schema);
  const outputSchema = ["evidence-score", "narrative", "positioning", "release", "promotion"].includes(groupName) ? compactStructuredSchema(rawOutputSchema) : rawOutputSchema;
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
    if (responseMode === "json_schema") {
      responseMode = "json_object";
      lastError += " Strict structured output repeated the local validation failure. Switch to JSON-object mode and repair the exact field paths while preserving all valid evidence.";
      return true;
    }
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
      { role: "system", content: (groupName === "evidence-score" ? EVIDENCE_SCORE_SYSTEM_PROMPT : groupName === "production" ? PRODUCTION_SYSTEM_PROMPT : ["narrative", "positioning", "release", "promotion"].includes(groupName) ? NARRATIVE_SYSTEM_PROMPT : SYSTEM_PROMPT) + " " + instructions + schemaGuidance },
      {
        role: "user",
        content: JSON.stringify({
          promptVersion: GROQ_PROMPT_VERSION,
          sectionGroup: groupName,
          evidence: compactPromptValue(compactEvidenceForGroq(input.evidence, groupName)),
          sonicDna: compactSonicDnaForGroq(input.sonicDna, groupName),
          catalogMetadata: compactCatalogMetadataForGroup(input.catalogMetadata, groupName, input.evidence),
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
    // Use a deliberately conservative 2-bytes-per-token estimate over the complete
    // serialized prompt and structured-output schema. A strict 1-byte-per-token
    // ceiling overcounts JSON schema syntax so heavily that normal sections are
    // rejected before reaching Groq; the 256-token allowance covers framing.
    const estimatedInputTokens = Math.ceil(new TextEncoder().encode(JSON.stringify({ messages, response_format: requestBody.response_format })).length / 2) + 256;
    const sectionOutputBudget = Math.floor(Math.min(MAX_COMPLETION_TOKENS, SECTION_COMPLETION_BUDGETS[groupName] ?? 600) * (providerName === "groq" ? groqCompletionBudgetScale : 1));
    const groqTpmBudgetApplies = providerName === "groq";
    // The 6,000-token ceiling is a Groq TPM safeguard, not a global model
    // output limit. Applying it to Gemini/Ollama starved evidence-score of its
    // 1,000-token module budget even when those providers had ample capacity.
    completionTokenBudget = groqTpmBudgetApplies
      ? Math.min(sectionOutputBudget, MAX_GROQ_TOTAL_TOKENS - estimatedInputTokens)
      : sectionOutputBudget;
    if (groqTpmBudgetApplies && (completionTokenBudget < MIN_COMPLETION_TOKENS || estimatedInputTokens + completionTokenBudget > MAX_GROQ_TOTAL_TOKENS)) {
      const userPrompt = JSON.parse(messages[1].content) as Record<string, unknown>;
      const byteLength = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value ?? null)).length;
      console.warn(JSON.stringify({
        event: "provider_preflight_rejection", provider: providerName, model, group: groupName,
        failureKind: "prompt_budget_exceeded", estimatedInputTokens,
        minimumCompletionTokens: MIN_COMPLETION_TOKENS, maxTotalTokens: MAX_GROQ_TOTAL_TOKENS,
        promptBytes: {
          system: byteLength(messages[0].content),
          evidence: byteLength(userPrompt.evidence),
          sonicDna: byteLength(userPrompt.sonicDna),
          catalogMetadata: byteLength(userPrompt.catalogMetadata),
          responseSchema: byteLength(requestBody.response_format),
        },
      }));
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
          retryable: !signal?.aborted, attempt: networkAttempt + 1, group: groupName,
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
      } else if (response.status === 402) {
        // HTTP 402 is a provider billing/account gate, not a transient failure.
        // Stop selecting this provider for later jobs handled by this worker process.
        markAssessmentProviderUnavailable(providerName as "groq" | "gemini" | "ollama", "billing_required");
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
        group: groupName,
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
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName, failureKind: "empty_content" });
      if (scheduleCorrection("The response contained no JSON content. Return one complete JSON object matching outputSchema.")) continue;
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName, failureKind: "invalid_json" });
      if (scheduleCorrection("The response was not valid JSON. Return raw JSON only, without markdown or surrounding prose.")) continue;
      break;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName, failureKind: "schema_violation", validationIssues: result.error.issues.slice(0, 12).map(issue => ({ code: issue.code, path: issue.path.map(part => String(part)).slice(0, 8) })) });
      const detail = responseMode === "json_object" || responseMode === "prompt_only"
        ? "The " + responseMode + " response failed local Zod validation: " + result.error.message + "."
        : "Strict structured output failed local Zod validation: " + result.error.message + ".";
      if (scheduleCorrection(detail + " Correct every reported field and return the complete schema object.")) continue;
      break;
    }

    const wordError = thresholdError(groupName, result.data);
    if (wordError) {
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName, failureKind: "threshold_violation", ...safeThresholdDiagnostic(groupName, result.data, wordError) });
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
      sonicDna: input.sonicDna,
    };
    const tasks=[
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"narrative","Write the executive assessment, identity, strengths and risks.",NarrativeSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"positioning",POSITIONING_INSTRUCTIONS,PositioningSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"release","Write a grounded release recommendation and priorities.",ReleaseSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"evidence-score","Score only evidence-derivable dimensions; return evidenceLabels and the unscored checklist. Follow local word-count minima, including the 25-word null rhythmicConsistency rationale. Repair only named fields; preserve evidence meaning.",EvidenceScoreSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
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
    assembled.generationProvenance = {
      provider: this.providerName as "groq" | "gemini" | "ollama",
      model: this.model,
      promptVersion: GROQ_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      fieldGroups: {
        assessmentVersion: "narrative", executiveSummary: "narrative", creativeIdentity: "narrative", strengths: "narrative", risks: "narrative",
        aAndRPositioning: "positioning", commercialRead: "positioning", releaseStrategy: "release",
        evidenceGaps: "evidence-score", confidence: "evidence-score", limitations: "evidence-score", scorecard: "evidence-score", humanListeningChecklist: "evidence-score", evidenceLabels: "evidence-score",
        productionArrangementGuidance: "production", industryPractice: "production", listeningChecks: "production",
        laneHypothesis: "comparables", referencesToVerify: "comparables", verificationMethod: "comparables",
        promotionPlan: "promotion", labelPartnerFit: "label-fit", executionPlan: "timeline",
      },
    };
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
