import { z } from "zod";

export const GROQ_PROMPT_VERSION = "audit-ar-v2";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const EvidenceLabelSchema = z.object({
  label: z.enum(["OBSERVED", "RECOGNIZED", "RECONCILED", "INFERRED"]),
  claim: z.string().min(24),
  source: z.string().min(2),
});

const ScoreSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  rationale: z.string().min(80),
});

const NarrativeSchema = z.object({
  assessmentVersion: z.string().min(1),
  executiveSummary: z.string().min(120),
  creativeIdentity: z.string().min(100),
  strengths: z.array(z.string().min(20)).min(3).max(12),
  risks: z.array(z.string().min(20)).min(2).max(12),
});

const PositioningSchema = z.object({
  aAndRPositioning: z.object({
    primaryLane: z.string().min(1),
    adjacentLanes: z.array(z.string().min(1)).max(8),
    rationale: z.string().min(100),
  }),
  commercialRead: z.object({
    marketability: z.enum(["high", "moderate", "low", "undetermined"]),
    rationale: z.string().min(100),
  }),
});

const ReleaseSchema = z.object({
  releaseStrategy: z.object({
    recommendation: z.string().min(100),
    priorities: z.array(z.string().min(20)).min(3).max(10),
  }),
});

const EvidenceScoreSchema = z.object({
  evidenceGaps: z.array(z.string().min(12)).min(1).max(12),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(12)).min(1).max(12),
  scorecard: z.object({
    sonicIdentity: ScoreSchema,
    metadataIntegrity: ScoreSchema,
    commercialEvidence: ScoreSchema,
    releaseReadiness: ScoreSchema,
    hook: ScoreSchema,
    originality: ScoreSchema,
    production: ScoreSchema,
    replayValue: ScoreSchema,
    laneClarity: ScoreSchema,
  }),
  evidenceLabels: z.array(EvidenceLabelSchema).min(1).max(24),
});

const AssessmentSchema = NarrativeSchema
  .extend(PositioningSchema.shape)
  .extend(ReleaseSchema.shape)
  .extend(EvidenceScoreSchema.shape);

export type ArAssessment = z.infer<typeof AssessmentSchema>;

export interface GroqAssessmentInput {
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  catalogMetadata?: Record<string, unknown> | null;
}

export interface GroqAssessmentClient {
  assess(input: GroqAssessmentInput): Promise<ArAssessment>;
}

const SYSTEM_PROMPT = [
  "You are the A&R intelligence analyst for a private music-audit service.",
  "Use only facts in the supplied evidence. Never invent identity, metadata, Sonic DNA, audience metrics, streams, sales, playlist data, revenue, or external facts.",
  "Observed measurements outrank recognition; recognition and metadata reconciliation must retain their source and confidence.",
  "Use OBSERVED only for measurements from the uploaded master, RECOGNIZED for AudD or named DSP catalog identification, RECONCILED for fields corroborated or reconciled across named sources, and INFERRED only for interpretation.",
  "Every evidence label must name a source present in the payload. Do not label a recommendation as an observed fact.",
  "When market-performance evidence is absent, marketability must be undetermined and commercialEvidence.score must be null.",
  "A null score means there is insufficient evidence to score the dimension. Explain the missing evidence in its rationale.",
  "Score rationales must explain the supplied evidence and the limits of the score. Do not use generic praise.",
  "For hook, originality, production, replayValue and laneClarity, use only supported listening or source evidence. If the evidence does not support a score, return score null and explain why in the rationale.",
  "Return JSON only. Do not wrap it in markdown. Meet every minimum length and array threshold in the requested schema."
].join(" ");

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function wordThresholdError(groupName: string, value: unknown): string | null {
  const data = value as Record<string, unknown>;
  const checkText = (label: string, text: unknown, minimum: number): string | null => {
    if (typeof text !== "string" || countWords(text) < minimum) {
      return label + " must contain at least " + minimum + " words.";
    }
    return null;
  };
  const checkList = (label: string, items: unknown, minimumItems: number, minimumWords: number): string | null => {
    if (!Array.isArray(items) || items.length < minimumItems) {
      return label + " must contain at least " + minimumItems + " items.";
    }
    for (let index = 0; index < items.length; index++) {
      const error = checkText(label + "[" + index + "]", items[index], minimumWords);
      if (error) return error;
    }
    return null;
  };

  if (groupName === "narrative") {
    return checkText("executiveSummary", data.executiveSummary, 45)
      ?? checkText("creativeIdentity", data.creativeIdentity, 35)
      ?? checkList("strengths", data.strengths, 3, 10)
      ?? checkList("risks", data.risks, 2, 10);
  }
  if (groupName === "positioning") {
    const positioning = data.aAndRPositioning as Record<string, unknown> | undefined;
    const commercial = data.commercialRead as Record<string, unknown> | undefined;
    return checkText("aAndRPositioning.rationale", positioning?.rationale, 40)
      ?? checkText("commercialRead.rationale", commercial?.rationale, 40);
  }
  if (groupName === "release") {
    const strategy = data.releaseStrategy as Record<string, unknown> | undefined;
    return checkText("releaseStrategy.recommendation", strategy?.recommendation, 40)
      ?? checkList("releaseStrategy.priorities", strategy?.priorities, 3, 8);
  }
  if (groupName === "evidence-score") {
    const scorecard = data.scorecard as Record<string, Record<string, unknown>> | undefined;
    const labels = data.evidenceLabels as Array<Record<string, unknown>> | undefined;
    return checkList("evidenceGaps", data.evidenceGaps, 1, 8)
      ?? checkList("limitations", data.limitations, 1, 8)
      ?? checkText("scorecard.sonicIdentity.rationale", scorecard?.sonicIdentity?.rationale, 25)
      ?? checkText("scorecard.metadataIntegrity.rationale", scorecard?.metadataIntegrity?.rationale, 25)
      ?? checkText("scorecard.commercialEvidence.rationale", scorecard?.commercialEvidence?.rationale, 25)
      ?? checkText("scorecard.releaseReadiness.rationale", scorecard?.releaseReadiness?.rationale, 25)
      ?? checkText("scorecard.hook.rationale", scorecard?.hook?.rationale, 25)
      ?? checkText("scorecard.originality.rationale", scorecard?.originality?.rationale, 25)
      ?? checkText("scorecard.production.rationale", scorecard?.production?.rationale, 25)
      ?? checkText("scorecard.replayValue.rationale", scorecard?.replayValue?.rationale, 25)
      ?? checkText("scorecard.laneClarity.rationale", scorecard?.laneClarity?.rationale, 25)
      ?? (labels ?? []).reduce<string | null>((error, label, index) =>
        error ?? checkText("evidenceLabels[" + index + "].claim", label.claim, 8), null);
  }
  return null;
}

async function requestGroup<T>(
  fetchImpl: typeof fetch,
  apiKey: string,
  model: string,
  input: GroqAssessmentInput,
  groupName: string,
  instructions: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let lastValidationError = "No valid response was returned";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ar_" + groupName,
            strict: true,
            schema: z.toJSONSchema(schema),
          },
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT + " " + instructions },
          {
            role: "user",
            content: JSON.stringify({
              promptVersion: GROQ_PROMPT_VERSION,
              sectionGroup: groupName,
              evidence: input.evidence,
              sonicDna: input.sonicDna,
              catalogMetadata: input.catalogMetadata ?? null,
              correction: attempt === 0 ? null : lastValidationError,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Groq " + groupName + " assessment failed with HTTP " + response.status + (detail ? ": " + detail.slice(0, 300) : ""));
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      lastValidationError = "The response contained no JSON content.";
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      lastValidationError = "The response was not valid JSON.";
      continue;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      lastValidationError = result.error.message;
      continue;
    }
    const thresholdError = wordThresholdError(groupName, result.data);
    if (thresholdError) {
      lastValidationError = thresholdError;
      continue;
    }
    return result.data;
  }

  throw new Error("Groq " + groupName + " response failed Zod validation after one retry: " + lastValidationError);
}

export class GroqClient implements GroqAssessmentClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_API,
    model = process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("GROQ_API is required");
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async assess(input: GroqAssessmentInput): Promise<ArAssessment> {
    const [narrative, positioning, release, evidence] = await Promise.all([
      requestGroup(this.fetchImpl, this.apiKey, this.model, input, "narrative",
        "Write the executive assessment, creative identity, at least three evidence-grounded strengths, and at least two concrete risks.", NarrativeSchema),
      requestGroup(this.fetchImpl, this.apiKey, this.model, input, "positioning",
        "Write A&R positioning and a commercial read. Do not infer marketability without market evidence.", PositioningSchema),
      requestGroup(this.fetchImpl, this.apiKey, this.model, input, "release",
        "Write a release recommendation and at least three concrete priorities grounded in the supplied evidence.", ReleaseSchema),
      requestGroup(this.fetchImpl, this.apiKey, this.model, input, "evidence-score",
        "List evidence gaps and limitations, provide four evidence-based scorecard dimensions with rationales, and label factual claims with their provenance.", EvidenceScoreSchema),
    ]);

    const combined = AssessmentSchema.safeParse({
      ...narrative,
      ...positioning,
      ...release,
      ...evidence,
    });
    if (!combined.success) {
      throw new Error("Combined Groq assessment failed Zod validation: " + combined.error.message);
    }
    return combined.data;
  }
}

export { AssessmentSchema, EvidenceLabelSchema };
