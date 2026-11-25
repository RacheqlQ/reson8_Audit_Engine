import { z } from "zod";
import { sanitizeAssessmentForEvidence } from "../../reports/evidence-guardrails.js";
import { sharedGroqTokenLimiter } from "../token-per-minute-limiter.js";
import { markAssessmentProviderUnavailable } from "../provider-policy.js";

export const GROQ_PROMPT_VERSION = "audit-ar-v10-contract-recovery-2026-11-25";
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
  failureKind?: "empty_content" | "invalid_json" | "schema_violation" | "threshold_violation" | "prompt_budget_exceeded" | "completion_truncated";
  validationIssues?: Array<{ code: string; path: string[] }>;
  failureClass?: "preflight_budget" | "malformed_output" | "threshold_violation" | "capacity_or_503" | "network" | "timeout" | "completion_truncated";
  estimatedInputTokens?: number;
  actualUsage?: { status: "reported" | "unavailable"; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  finishReason?: string | null;
  completionTokenBudget?: number;
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
  loadCompletedSectionGroup?: (group: string, provider: "groq" | "gemini" | "ollama", model: string) => Promise<unknown | null>;
  saveCompletedSectionGroup?: (group: string, result: unknown, provider: "groq" | "gemini" | "ollama", model: string) => Promise<void>;
}
export interface GroqAssessmentClient { assess(input: GroqAssessmentInput, signal?: AbortSignal): Promise<ArAssessment>; }

const SYSTEM_PROMPT = [
  "Evidence only; never invent streams, sales, revenue, playlists, curators, audience metrics, label interest, placements or facts.",
  "Labels: OBSERVED=uploaded-master measurement; RECOGNIZED=one named provider; RECONCILED=2+ independent agreeing providers; INFERRED=groq_assessment; INDUSTRY PRACTICE=industry_practice, not a track fact. Name only providers with records.",
  "Preserve exact provider genres and scene tags; null primary genre=no confirmed lane. Tempo contributes at most 15% to genre scoring and never proves genre; BPM only when confirmed at confidence >=0.5.",
  "Tempo/key are CONFIRMED only via voting/window-consensus-stabilized results; otherwise provisional. Mood/energy are heuristics, not probabilities or demand. Vocals only when status=analyzed; otherwise infer no voice, lyrics or arrangement. Require explicit section boundaries.",
  "Reconcile identity/provenance; preserve ISRC conflicts and ambiguity. DSP/catalog links are not audio and cannot establish OBSERVED audio. No external stem, separation or render workers.",
  "Without verified commercial telemetry, marketability=undetermined. Release date DETERMINED only from verified evidence; preserve PRE_RELEASE versus POST_RELEASE and PRE_RELEASE/POST_RELEASE. Market verdict PROPOSED absent deterministic evidence.",
  "Null score=insufficient evidence. RMS/dBFS do not prove mastering readiness; loudness changes need measured fault+destination target. Centroid <=2,000 Hz is not bright; mono is a risk, not proof of incompatibility.",
  "Do not score taste/hook/originality/production/replay/lane clarity; keep in the unscored human-listening checklist. Return JSON only as one complete object; obey local validation."
].join(" ");
const NARRATIVE_SYSTEM_PROMPT = SYSTEM_PROMPT + " Return exactly 3 distinct evidence-grounded strengths and exactly 2 distinct evidence-grounded risks; each must be specific, evidence-linked and non-repetitive. Keep executiveSummary to 45–60 words and creativeIdentity to 35–50 words. Use one concise sentence per strength and risk; omit preambles, repetition and commentary outside the requested JSON fields.";
const POSITIONING_INSTRUCTIONS = "aAndRPositioning.rationale and commercialRead.rationale must each contain at least 40 words. Ground each in supplied evidence or explicitly name the evidence gap; never pad or infer demand without verified commercial telemetry.";
const PRODUCTION_SYSTEM_PROMPT = NARRATIVE_SYSTEM_PROMPT + " RMS/dBFS are descriptive, not mastering readiness; loudness changes require a measured fault and destination target.";
const EVIDENCE_SCORE_SYSTEM_PROMPT = SYSTEM_PROMPT + " Always include the evidenceLabels array (label, claim, actual source). Every scorecard rationale must contain at least 25 words, including optional tonalConsensus when present. Null scores mean insufficient evidence; taste stays unscored.";

function words(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }
type SectionWordRule = {
  path: string;
  minWords?: number;
  minItems?: number;
  itemMinWords?: number;
  optional?: boolean;
};

const SECTION_WORD_RULES: Record<string, SectionWordRule[]> = {
  narrative: [
    { path: "executiveSummary", minWords: 45 }, { path: "creativeIdentity", minWords: 35 },
    { path: "strengths", minItems: 3, itemMinWords: 10 }, { path: "risks", minItems: 2, itemMinWords: 10 },
  ],
  positioning: [
    { path: "aAndRPositioning.rationale", minWords: 40 },
    { path: "commercialRead.rationale", minWords: 40 },
  ],
  release: [
    { path: "releaseStrategy.recommendation", minWords: 40 },
    { path: "releaseStrategy.priorities", minItems: 3, itemMinWords: 8 },
  ],
  "evidence-score": [
    { path: "evidenceGaps", minItems: 1, itemMinWords: 8 },
    { path: "limitations", minItems: 1, itemMinWords: 8 },
    { path: "scorecard.tempoLaneFit.rationale", minWords: 25 },
    { path: "scorecard.rhythmicConsistency.rationale", minWords: 25 },
    { path: "scorecard.tonalConsensus.rationale", minWords: 25, optional: true },
    { path: "scorecard.dynamicRangeLoudness.rationale", minWords: 25 },
    { path: "scorecard.metadataCompleteness.rationale", minWords: 25 },
    { path: "scorecard.releaseReadiness.rationale", minWords: 25 },
    { path: "humanListeningChecklist", minItems: 5, itemMinWords: 5 },
  ],
  production: [
    { path: "productionArrangementGuidance", minWords: 40 }, { path: "industryPractice", minWords: 25 },
    { path: "listeningChecks", minItems: 4, itemMinWords: 5 },
  ],
  comparables: [
    { path: "laneHypothesis", minWords: 20 }, { path: "referencesToVerify", minItems: 3, itemMinWords: 8 },
    { path: "verificationMethod", minWords: 20 },
  ],
  promotion: [
    { path: "promotionPlan.preRelease", minWords: 20 }, { path: "promotionPlan.releaseWindow", minWords: 20 },
    { path: "promotionPlan.postRelease", minWords: 20 }, { path: "promotionPlan.contentIdeas", minItems: 4, itemMinWords: 5 },
    { path: "promotionPlan.pitchingAngles", minItems: 3, itemMinWords: 5 },
    { path: "promotionPlan.playlistCategories", minItems: 3, itemMinWords: 3 },
    { path: "promotionPlan.industryPractice", minWords: 20 },
  ],
  "label-fit": [
    { path: "labelPartnerFit.partnerProfile", minWords: 25 },
    { path: "labelPartnerFit.criteriaToDemonstrate", minItems: 4, itemMinWords: 5 },
    { path: "labelPartnerFit.diligenceBeforeContact", minWords: 20 },
    { path: "labelPartnerFit.industryPractice", minWords: 20 },
  ],
  timeline: [
    { path: "executionPlan.days30", minWords: 20 }, { path: "executionPlan.days60", minWords: 20 },
    { path: "executionPlan.days90", minWords: 20 },
  ],
};

interface ThresholdViolation {
  validationField: string;
  validationRule: "minimum_word_count" | "minimum_item_count";
  minimumWords?: number;
  actualWords?: number;
  minimumItems?: number;
  actualItems?: number;
}

function readAssessmentPath(value: unknown, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)
    .reduce((current: any, key) => current?.[/^\d+$/.test(key) ? Number(key) : key], value);
}

function thresholdViolations(group: string, value: unknown): ThresholdViolation[] {
  const violations: ThresholdViolation[] = [];
  for (const rule of SECTION_WORD_RULES[group] ?? []) {
    const actual = readAssessmentPath(value, rule.path);
    if (actual === undefined && rule.optional) continue;
    if (rule.minItems !== undefined) {
      const items = Array.isArray(actual) ? actual : [];
      if (!Array.isArray(actual) || items.length < rule.minItems) {
        violations.push({ validationField: rule.path, validationRule: "minimum_item_count", minimumItems: rule.minItems, actualItems: items.length });
        continue;
      }
      if (rule.itemMinWords !== undefined) {
        items.forEach((item, index) => {
          const count = typeof item === "string" ? words(item) : 0;
          if (count < rule.itemMinWords!) violations.push({
            validationField: rule.path + "[" + index + "]", validationRule: "minimum_word_count",
            minimumWords: rule.itemMinWords, actualWords: count,
          });
        });
      }
      continue;
    }
    const count = typeof actual === "string" ? words(actual) : 0;
    if (rule.minWords !== undefined && count < rule.minWords) violations.push({
      validationField: rule.path, validationRule: "minimum_word_count",
      minimumWords: rule.minWords, actualWords: count,
    });
  }
  return violations;
}

function formatThresholdViolations(violations: ThresholdViolation[]): string {
  return violations.map(issue => issue.validationRule === "minimum_item_count"
    ? issue.validationField + " must contain at least " + issue.minimumItems + " items (received " + issue.actualItems + ")."
    : issue.validationField + " must contain at least " + issue.minimumWords + " words (received " + issue.actualWords + ")."
  ).join(" ");
}

function thresholdContractInstructions(group: string): string {
  const rules = SECTION_WORD_RULES[group] ?? [];
  const limits = rules.map(rule => rule.minItems !== undefined
    ? rule.path + ">=" + rule.minItems + " items" + (rule.itemMinWords !== undefined ? ", each>=" + rule.itemMinWords + " words" : "")
    : rule.path + ">=" + rule.minWords + " words" + (rule.optional ? " if present" : ""));
  return limits.length ? "Mandatory word minima (all enforced locally): " + limits.join("; ") + "." : "";
}

function compactedSchemaConstraintInstructions(schema: unknown): string {
  const constraints = new Map<string, Set<string>>();
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, any>;
    const normalizedPath = path
      .replace(/^scorecard\.[^.]+\.score$/, "scorecard.*.score")
      .replace(/^scorecard\.[^.]+\.rationale$/, "scorecard.*.rationale");
    const bounds = constraints.get(normalizedPath) ?? new Set<string>();
    if (typeof record.minLength === "number") bounds.add(">=" + record.minLength + "ch");
    if (typeof record.maxLength === "number") bounds.add("<=" + record.maxLength + "ch");
    if (typeof record.minItems === "number" || typeof record.maxItems === "number") bounds.add("items=" + (record.minItems ?? 0) + ".." + (record.maxItems ?? "∞"));
    if (typeof record.minimum === "number" || typeof record.maximum === "number") bounds.add("number=" + (record.minimum ?? "-∞") + ".." + (record.maximum ?? "∞"));
    if (bounds.size) constraints.set(normalizedPath, bounds);
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties)) visit(child, path ? path + "." + key : key);
    }
    if (record.items) visit(record.items, path + "[]");
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(record[key])) record[key].forEach((child: unknown) => visit(child, path));
    }
  };
  visit(schema, "");
  const limits = [...constraints.entries()].map(([path, bounds]) => path + " " + [...bounds].join(" "));
  return limits.length ? "Compacted local schema bounds (all mandatory): " + limits.join("; ") + "." : "";
}
function safeThresholdDiagnostic(violation: ThresholdViolation): ThresholdViolation {
  return violation;
}

const MAX_PROVIDER_RETRY_DELAY_MS = 60_000;
let groqDailyCapUntil = 0;
const MAX_NETWORK_ATTEMPTS = 3;
const MAX_GEMINI_NETWORK_ATTEMPTS = 5;
export const GROQ_REQUEST_TIMEOUT_MS = 55_000;
export const GROQ_ASSESSMENT_TIMEOUT_MS = 7 * 60_000;
export const GEMINI_ASSESSMENT_TIMEOUT_MS = 3 * 60_000;
export const OLLAMA_ASSESSMENT_TIMEOUT_MS = 2 * 60_000;
const MAX_COMPLETION_TOKENS = 1600;
const MAX_GROQ_COMPLETION_TOKENS = 2000;
const MAX_SHARED_PROVIDER_TOTAL_TOKENS = 6000;
const SECTION_COMPLETION_BUDGETS: Record<string, number> = {
  narrative: 850, positioning: 650, release: 500, "evidence-score": 1000,
  production: 650, comparables: 450, promotion: 900, "label-fit": 650, timeline: 500,
};
const MIN_COMPLETION_TOKENS = 256;
const NARRATIVE_INITIAL_HEADROOM_TOKENS = 500;
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

function compactCorrectionInstruction(reason: string): string {
  if (/strict JSON-schema validation failed/i.test(reason)) {
    return "Groq strict JSON-schema validation failed. Retry in JSON-object mode with one complete object matching outputSchema; preserve evidence, provenance, verdicts and nulls.";
  }
  const localValidation = reason.match(/(?:json_object|prompt_only) response failed local Zod validation:\s*([\s\S]*?)(?:\. Correct every reported field|$)/i);
  if (localValidation) {
    const issues = localValidation[1].replace(/\s+/g, " ").trim();
    return "Local schema validation issues: " + (issues.length > 300 ? issues.slice(0, 297) + "..." : issues)
      + ". Correct the named fields using outputSchema; return one complete object and preserve all evidence.";
  }
  const safeReason = reason
    .replace(/(?:The )?(?:json_schema|json_object|prompt_only) response failed local Zod validation:\s*/i, "Schema validation issues: ")
    .replace(/Compacted local schema bounds \(all mandatory\):[^.]*\./g, "")
    .replace(/The user payload includes outputSchema,[^.]*\./g, "")
    .replace(/\s+/g, " ").trim();
  return safeReason.length > 360 ? safeReason.slice(0, 357) + "..." : safeReason;
}

function compactNarrativeContext(value: unknown, field = ""): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string") return value;
    const preserveLongValue = /^(claim|value|normalizedValue|source|provider|artist|title|isrc)$/i.test(field);
    const limit = preserveLongValue ? 120 : /^(description|commentary|notes|detail|reason|rawPayload)$/i.test(field) ? 24 : 32;
    return value.length > limit ? value.slice(0, limit) + "…" : value;
  }
  if (Array.isArray(value)) {
    const preserve = /^(sourceProviders|genres|catalogSources|matchedFields)$/i.test(field);
    const items = preserve || value.length <= 3 ? value : [value[0], value[Math.floor((value.length - 1) / 2)], value[value.length - 1]];
    return items.map(item => compactNarrativeContext(item, field));
  }
  const omitted = new Set(["rawPayload", "rawProviderPayload", "rawResponse", "responseBody", "debugPayload", "failed_generation", "description", "commentary", "notes", "debug"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !omitted.has(key))
    .map(([key, item]) => [key, compactNarrativeContext(item, key)]));
}

function compactNarrativeSonicDna(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const compacted = compactNarrativeContext(value) as Record<string, unknown>;
  const vocal = compacted.vocalFeatures;
  if (vocal && typeof vocal === "object" && !Array.isArray(vocal)) {
    const record = vocal as Record<string, unknown>;
    const keep = ["status", "provenance", "evidenceClass", "confidence", "method", "model", "voicePresence", "vocalPresence", "language", "limitations"];
    compacted.vocalFeatures = Object.fromEntries(keep.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
  }
  const profile = compacted.acousticFeatureProfile;
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    delete (profile as Record<string, unknown>).predictions;
  }
  return compacted;
}

function estimatePromptInputTokens(messages: Array<{ role: string; content: string }>, responseFormat: unknown): number {
  // Production telemetry showed a 3-byte estimate undercounted Groq actual prompt usage.
  // Use a conservative 2-byte ratio plus framing headroom to reserve completion capacity
  // before dispatch, including adaptive narrative retries.
  return Math.ceil(new TextEncoder().encode(JSON.stringify({ messages, response_format: responseFormat })).length / 2) + 256;
}

function compactProviderPromptForBudget(
  messages: Array<{ role: string; content: string }>,
  responseFormat: unknown,
  groupName: string,
  targetInputTokens: number,
): { before: number; after: number } {
  const before = estimatePromptInputTokens(messages, responseFormat);
  if (before <= targetInputTokens) return { before, after: before };
  const payload = JSON.parse(messages[1].content) as Record<string, unknown>;
  payload.correction = compactCorrectionInstruction(String(payload.correction ?? ""));
  payload.evidence = compactNarrativeContext(payload.evidence);
  if (groupName === "narrative" && payload.evidence && typeof payload.evidence === "object" && !Array.isArray(payload.evidence)) {
    const evidence = payload.evidence as Record<string, unknown>;
    if (Array.isArray(evidence.sourceProviders) && evidence.fieldProvenance && typeof evidence.fieldProvenance === "object") {
      // These are duplicate catalog summaries; source names and field-level
      // provenance remain in the mandatory canonical evidence fields.
      delete evidence.catalogSources;
      delete evidence.metadataSourcesChecked;
    }
  }
  payload.sonicDna = groupName === "narrative" ? compactNarrativeSonicDna(payload.sonicDna) : compactNarrativeContext(payload.sonicDna);
  payload.catalogMetadata = compactNarrativeContext(payload.catalogMetadata);
  messages[1].content = JSON.stringify(payload);
  messages[0].content = messages[0].content
    .replace(/ Compacted local schema bounds \(all mandatory\):[^.]*\./g, "")
    .replace(/ The user payload includes outputSchema,[^.]*\./g, " Match the supplied outputSchema exactly; local validation remains mandatory.");
  let after = estimatePromptInputTokens(messages, responseFormat);
  if (after > targetInputTokens && groupName === "narrative") {
    const compactPayload = JSON.parse(messages[1].content) as Record<string, unknown>;
    compactPayload.correction = "Return one complete schema-valid JSON object. Preserve evidence, provenance, verdicts and nulls; repair only the failed output.";
    messages[1].content = JSON.stringify(compactPayload);
    after = estimatePromptInputTokens(messages, responseFormat);
  }
  return { before, after };
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
  const maxCompletionTokens = providerName === "groq" ? MAX_GROQ_COMPLETION_TOKENS : MAX_COMPLETION_TOKENS;
  let completionTokenBudget = maxCompletionTokens;
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
  const maxNetworkAttempts = providerName === "gemini" ? MAX_GEMINI_NETWORK_ATTEMPTS : MAX_NETWORK_ATTEMPTS;
  const tokenField = providerName === "groq" ? "max_completion_tokens" : "max_tokens";
  const rawOutputSchema = z.toJSONSchema(schema);
  const outputSchema = ["evidence-score", "narrative", "positioning", "release", "promotion"].includes(groupName) ? compactStructuredSchema(rawOutputSchema) : rawOutputSchema;
  const schemaConstraintGuidance = compactedSchemaConstraintInstructions(rawOutputSchema);
  const wordContractGuidance = thresholdContractInstructions(groupName);
  let completed: unknown | null = null;
  try {
    completed = await input.loadCompletedSectionGroup?.(cacheGroupName, providerName as "groq" | "gemini" | "ollama", model) ?? null;
  } catch (error) {
    console.warn(JSON.stringify({ event: "assessment_section_cache_read_failed", provider: providerName, model, group: groupName, errorName: error instanceof Error ? error.name : "UnknownError" }));
  }
  if (completed !== null && completed !== undefined) {
    const cached = schema.safeParse(completed);
    if (cached.success && thresholdViolations(groupName, cached.data).length === 0) return cached.data;
  }

  let adaptiveCompletionTokenBudget = Math.min(maxCompletionTokens, SECTION_COMPLETION_BUDGETS[groupName] ?? 600);

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

  // Recalibrate subsequent retries from Groq's reported prompt usage. The
  // serialized JSON estimator is intentionally conservative on the first call,
  // but a same-group retry should not keep reserving tokens the provider did not use.
  let lastReportedPromptTokens: number | null = null;
  let lastReportedPromptBytes: number | null = null;

  for (let attempt = 0; attempt < MAX_SECTION_REQUEST_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const fallbackMode = responseMode !== "json_schema";
    const schemaGuidance = fallbackMode
      ? " Match the supplied outputSchema exactly. Return one complete JSON object only; do not include outputSchema in the result. Local Zod and word-count validation remain mandatory."
      : "";
    const messages = [
      { role: "system", content: (groupName === "evidence-score" ? EVIDENCE_SCORE_SYSTEM_PROMPT : groupName === "production" ? PRODUCTION_SYSTEM_PROMPT : ["narrative", "positioning", "release", "promotion"].includes(groupName) ? NARRATIVE_SYSTEM_PROMPT : SYSTEM_PROMPT) + " " + instructions + " " + wordContractGuidance + (fallbackMode ? "" : " " + schemaConstraintGuidance) + schemaGuidance },
      {
        role: "user",
        content: JSON.stringify({
          promptVersion: GROQ_PROMPT_VERSION,
          sectionGroup: groupName,
          evidence: compactPromptValue(compactEvidenceForGroq(input.evidence, groupName)),
          sonicDna: compactSonicDnaForGroq(input.sonicDna, groupName),
          catalogMetadata: compactCatalogMetadataForGroup(input.catalogMetadata, groupName, input.evidence),
          correction: attempt === 0 ? null : compactCorrectionInstruction(lastError),
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
    // Use a conservative 3-bytes-per-token estimate over the complete serialized
    // prompt and structured-output schema. Production telemetry showed the former
    // 2-byte estimate was roughly 2x actual prompt usage for this JSON workload;
    // 3 bytes remains above observed usage while reserving room for valid output.
    // The 256-token allowance covers framing.
    let estimatedInputTokens = estimatePromptInputTokens(messages, requestBody.response_format);
    const sectionOutputBudget = adaptiveCompletionTokenBudget;
    const sharedTotalBudgetApplies = providerName === "groq" || providerName === "gemini";
    const targetInputTokens = MAX_SHARED_PROVIDER_TOTAL_TOKENS
      - Math.max(MIN_COMPLETION_TOKENS, sectionOutputBudget)
      - (groupName === "narrative" && attempt === 0 ? NARRATIVE_INITIAL_HEADROOM_TOKENS : 0);
    if (sharedTotalBudgetApplies && estimatedInputTokens > targetInputTokens) {
      const before = estimatedInputTokens;
      const compacted = compactProviderPromptForBudget(messages, requestBody.response_format, groupName, targetInputTokens);
      estimatedInputTokens = compacted.after;
      let compactionPass = 1;
      if (groupName === "evidence-score" && estimatedInputTokens > targetInputTokens) {
        const payload = JSON.parse(messages[1].content) as Record<string, unknown>;
        // Evidence-score already has canonical identity/provenance. Tighten descriptive
        // summaries and repeated acoustic context without dropping source/status labels.
        payload.evidence = compactEvidenceScoreValue(payload.evidence, 0, 32, 2);
        payload.sonicDna = compactEvidenceScoreValue(payload.sonicDna, 0, 32, 2);
        payload.catalogMetadata = compactEvidenceScoreValue(payload.catalogMetadata, 0, 24, 2);
        payload.correction = "Return one complete schema-valid evidence-score object. Preserve source labels, evidence classes, verified facts, nulls and all local validation minima.";
        messages[1].content = JSON.stringify(payload);
        estimatedInputTokens = estimatePromptInputTokens(messages, requestBody.response_format);
        compactionPass = 2;
      }
      console.info(JSON.stringify({
        provider: providerName, event: "prompt_budget_recovery", group: groupName,
        attempt: attempt + 1, estimatedInputTokensBefore: before,
        estimatedInputTokensAfter: estimatedInputTokens, targetInputTokens,
        reservedCompletionTokens: Math.max(MIN_COMPLETION_TOKENS, sectionOutputBudget),
        maxTotalTokens: MAX_SHARED_PROVIDER_TOTAL_TOKENS, compactionPass,
      }));
    }
    const serializedPromptBytes = new TextEncoder().encode(JSON.stringify({
      messages, response_format: requestBody.response_format,
    })).length;
    if (providerName === "groq" && lastReportedPromptTokens !== null && lastReportedPromptBytes !== null) {
      const usageCalibratedEstimate = Math.ceil(
        (serializedPromptBytes / Math.max(1, lastReportedPromptBytes)) * lastReportedPromptTokens * 1.25,
      ) + 128;
      estimatedInputTokens = Math.min(estimatedInputTokens, usageCalibratedEstimate);
    }
    completionTokenBudget = sharedTotalBudgetApplies
      ? Math.min(adaptiveCompletionTokenBudget, MAX_SHARED_PROVIDER_TOTAL_TOKENS - estimatedInputTokens)
      : adaptiveCompletionTokenBudget;
    if (sharedTotalBudgetApplies && (completionTokenBudget < MIN_COMPLETION_TOKENS || estimatedInputTokens + completionTokenBudget > MAX_SHARED_PROVIDER_TOTAL_TOKENS)) {
      const userPrompt = JSON.parse(messages[1].content) as Record<string, unknown>;
      const byteLength = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value ?? null)).length;
      await recordProviderAttempt(input, {
        provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: null,
        errorType: "provider_error", retryable: false, attempt: attempt + 1, group: groupName,
        failureKind: "prompt_budget_exceeded", failureClass: "preflight_budget",
        estimatedInputTokens, actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
      });
      console.warn(JSON.stringify({
        event: "provider_preflight_rejection", provider: providerName, model, group: groupName,
        failureKind: "prompt_budget_exceeded", failureClass: "preflight_budget", estimatedInputTokens,
        minimumCompletionTokens: MIN_COMPLETION_TOKENS, maxTotalTokens: MAX_SHARED_PROVIDER_TOTAL_TOKENS,
        promptBytes: {
          system: byteLength(messages[0].content),
          evidence: byteLength(userPrompt.evidence),
          sonicDna: byteLength(userPrompt.sonicDna),
          catalogMetadata: byteLength(userPrompt.catalogMetadata),
          responseSchema: byteLength(requestBody.response_format),
        },
      }));
      throw new Error("PROVIDER_PROMPT_BUDGET_EXCEEDED: " + providerName + " section payload cannot fit within the shared 6,000-token request budget");
    }
    requestBody[tokenField] = completionTokenBudget;
    console.info(JSON.stringify({ provider: providerName, event: "request_budget", group: groupName, estimatedInputTokens, maxCompletionTokens: completionTokenBudget, sectionOutputBudget, maxTotalTokens: sharedTotalBudgetApplies ? MAX_SHARED_PROVIDER_TOTAL_TOKENS : null, estimatedTotalTokens: estimatedInputTokens + completionTokenBudget }));

    let response: Response | null = null;
    for (let networkAttempt = 0; networkAttempt < maxNetworkAttempts; networkAttempt++) {
      signal?.throwIfAborted();
      // Each retry is a new provider request and must consume its own rolling TPM reservation.
      if (providerName === "groq" && process.env.NODE_ENV !== "test") {
        await sharedGroqTokenLimiter.acquire(estimatedInputTokens + completionTokenBudget, sleepImpl, signal);
      }
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
        const retryable = !signal?.aborted && networkAttempt < maxNetworkAttempts - 1;
        await recordProviderAttempt(input, {
          provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: null,
          errorType: timedOut ? "timeout" : "provider_unavailable",
          retryable: !signal?.aborted, attempt: networkAttempt + 1, group: groupName,
          failureClass: timedOut ? "timeout" : "network", estimatedInputTokens,
          actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
        });
        if (signal?.aborted) throw error;
        if (retryable) {
          const delay = Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(1000 * (2 ** networkAttempt) * (0.8 + Math.random() * 0.4)));
          await sleepImpl(delay, signal);
          signal?.throwIfAborted();
          continue;
        }
        if (timedOut) {
          throw new Error(providerLabel + " " + groupName + " request timed out after " + requestTimeoutMs + "ms and bounded network retries", { cause: error });
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
        failureClass: response.ok ? undefined : response.status === 400 ? "malformed_output" : response.status === 503 || response.status === 429 ? "capacity_or_503" : response.status >= 500 ? "network" : undefined,
        estimatedInputTokens,
        actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
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
      if (!transient || networkAttempt >= maxNetworkAttempts - 1) break;
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
        throw new Error("GROQ_REQUEST_TOO_LARGE: provider rejected the request; it was not retried. Completion budgets remain unchanged for subsequent audits.");
      }

      if (response?.status === 400 && providerError.error?.code === "json_validate_failed") {
        if (responseMode === "json_schema" && strictSchemaRetries < 1) {
          strictSchemaRetries++;
          responseMode = "json_object";
          lastError = "Groq strict JSON-schema validation failed for " + groupName + ". Retry once in JSON-object mode; preserve the complete schema contract and all evidence.";
          continue;
        }

        if (responseMode === "json_object" && jsonObjectProviderRetries < 2) {
          jsonObjectProviderRetries++;
          if (jsonObjectProviderRetries === 2) {
            responseMode = "prompt_only";
            lastError = "JSON-object output was rejected for " + groupName + ". Omit response_format and return one complete raw JSON object matching outputSchema.";
          } else {
            lastError = "JSON-object output was rejected for " + groupName + ". Retry with the supplied outputSchema and a complete JSON object.";
          }
          continue;
        }

        if (responseMode === "prompt_only" && promptOnlyProviderRetries < 1) {
          promptOnlyProviderRetries++;
          lastError = "Prompt-only JSON was rejected for " + groupName + ". Retry once with a complete raw JSON object matching outputSchema.";
          continue;
        }

        throw new Error("json_validate_failed: " + providerLabel + " " + groupName + " assessment failed with HTTP 400 after bounded JSON recovery: " + detail.slice(0, 300));
      }

      throw new Error("" + providerLabel + " " + groupName + " assessment failed with HTTP " + (response?.status ?? "unknown")
        + (detail ? ": " + detail.slice(0, 300) : ""));
    }

    let payload: { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    try {
      const decoded: unknown = await response.json();
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
        throw new Error("Provider response envelope must be a JSON object");
      }
      payload = decoded as typeof payload;
    } catch {
      await recordProviderAttempt(input, {
        provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status,
        errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName,
        failureKind: "invalid_json", failureClass: "malformed_output",
      });
      if (scheduleCorrection("The provider returned an invalid JSON response envelope with HTTP success. Return one complete JSON object in the required response format.")) continue;
      break;
    }
    const actualUsage = payload.usage && [payload.usage.prompt_tokens, payload.usage.completion_tokens, payload.usage.total_tokens].some(value => typeof value === "number")
      ? { status: "reported" as const, promptTokens: payload.usage.prompt_tokens ?? null, completionTokens: payload.usage.completion_tokens ?? null, totalTokens: payload.usage.total_tokens ?? null }
      : { status: "unavailable" as const, promptTokens: null, completionTokens: null, totalTokens: null };
    console.info(JSON.stringify({ provider: providerName, event: "response_usage", group: groupName, estimatedInputTokens, usageStatus: actualUsage.status, actualPromptTokens: actualUsage.promptTokens, actualCompletionTokens: actualUsage.completionTokens, actualTotalTokens: actualUsage.totalTokens }));
    if (providerName === "groq" && actualUsage.status === "reported" && actualUsage.promptTokens !== null) {
      lastReportedPromptTokens = actualUsage.promptTokens;
      lastReportedPromptBytes = serializedPromptBytes;
    }
    if (actualUsage.status === "reported") {
      await recordProviderAttempt(input, {
        provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status,
        errorType: "none", retryable: false, attempt: attempt + 1, group: groupName,
        estimatedInputTokens, actualUsage,
      });
    }
    const finishReason = payload.choices?.[0]?.finish_reason ?? null;
    const completionUsageAtLimit = actualUsage.status === "reported"
      && actualUsage.completionTokens !== null
      && actualUsage.completionTokens >= Math.floor(completionTokenBudget * 0.98);
    if (finishReason === "length" || (finishReason == null && completionUsageAtLimit)) {
      await recordProviderAttempt(input, {
        provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status,
        errorType: "malformed_output", retryable: true,
        attempt: attempt + 1, group: groupName, failureKind: "completion_truncated",
        failureClass: "completion_truncated", estimatedInputTokens, actualUsage,
        finishReason, completionTokenBudget,
      });
      const conciseRecovery = groupName === "narrative"
        ? "The previous narrative was truncated. Retry with the SAME completion-token allowance. Return exactly 3 concise strengths and 2 concise risks; keep executiveSummary 45–60 words and creativeIdentity 35–50 words. Preserve every schema minimum and evidence constraint."
        : "The previous section was truncated. Retry with the SAME completion-token allowance; keep every field concise at the minimum length required by outputSchema and the word contract. Return JSON only.";
      if (scheduleCorrection(conciseRecovery)) continue;
      break;
    }

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
      await recordProviderAttempt(input, { provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status, errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName, failureKind: "schema_violation", failureClass: "malformed_output", validationIssues: result.error.issues.slice(0, 12).map(issue => ({ code: issue.code, path: issue.path.map(part => String(part)).slice(0, 8) })) });
      const detail = responseMode === "json_object" || responseMode === "prompt_only"
        ? "The " + responseMode + " response failed local Zod validation: " + result.error.message + "."
        : "Strict structured output failed local Zod validation: " + result.error.message + ".";
      if (scheduleCorrection(detail + " Correct every reported field and return the complete schema object.")) continue;
      break;
    }

    const wordErrors = thresholdViolations(groupName, result.data);
    if (wordErrors.length) {
      for (const violation of wordErrors) {
        await recordProviderAttempt(input, {
          provider: providerName as ProviderAttemptDiagnostic["provider"], model, status: response.status,
          errorType: "malformed_output", retryable: true, attempt: attempt + 1, group: groupName,
          failureKind: "threshold_violation", failureClass: "threshold_violation", ...safeThresholdDiagnostic(violation),
        });
      }
      const correction = formatThresholdViolations(wordErrors);
      if (scheduleCorrection(correction + " Repair every named field and preserve the evidence-bounded meaning.")) continue;
      break;
    }
    try {
      await input.saveCompletedSectionGroup?.(cacheGroupName, result.data, providerName as "groq" | "gemini" | "ollama", model);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.message === "AUDIT_LEASE_LOST")) throw error;
      console.warn(JSON.stringify({ event: "assessment_section_cache_write_failed", provider: providerName, model, group: groupName, errorName: error instanceof Error ? error.name : "UnknownError" }));
    }
    return result.data;
  }

  throw new Error("" + providerLabel + " " + groupName + " response failed validation after bounded recovery: " + lastError);
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
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"narrative","Write the executive assessment, identity, strengths and risks. Keep executiveSummary 45–60 words and creativeIdentity 35–50 words. Return exactly 3 strengths and 2 risks, one concise sentence each, with no preamble or repeated points.",NarrativeSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"positioning",POSITIONING_INSTRUCTIONS,PositioningSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"release","Write a grounded release recommendation and priorities.",ReleaseSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,promptInput,"evidence-score","Score only evidence-derivable dimensions; preserve evidence meaning. Repair only named fields.",EvidenceScoreSchema,this.sleepImpl,signal,this.requestTimeoutMs,this.endpoint,this.providerName),
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
