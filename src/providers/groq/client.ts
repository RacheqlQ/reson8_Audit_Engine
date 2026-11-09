import { z } from "zod";

export const GROQ_PROMPT_VERSION = "audit-ar-v1";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const AssessmentSchema = z.object({
  assessmentVersion: z.string().min(1),
  executiveSummary: z.string().min(1),
  creativeIdentity: z.string().min(1),
  strengths: z.array(z.string()).max(12),
  risks: z.array(z.string()).max(12),
  aAndRPositioning: z.object({
    primaryLane: z.string().min(1),
    adjacentLanes: z.array(z.string()).max(8),
    rationale: z.string().min(1),
  }),
  commercialRead: z.object({
    marketability: z.enum(["high", "moderate", "low", "undetermined"]),
    rationale: z.string().min(1),
  }),
  releaseStrategy: z.object({
    recommendation: z.string().min(1),
    priorities: z.array(z.string()).max(10),
  }),
  evidenceGaps: z.array(z.string()).max(12),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()).max(12),
});

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
  "Interpret only the evidence supplied in the user payload.",
  "Never invent artist identity, metadata, Sonic DNA, audience metrics, market performance, playlist data, sales, streams, or external facts.",
  "Observed or verified measurements outrank interpretation. Missing evidence must remain missing.",
  "When market-performance evidence is absent, set commercialRead.marketability to undetermined.",
  "Genre/lane language is an interpretation of the supplied Sonic DNA, not a measured fact.",
  "Keep recommendations specific to the supplied recording and evidence.",
  "Return JSON only. Do not wrap it in markdown.",
  "The response must conform exactly to the requested schema."
].join(" ");

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
    const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ar_assessment",
            strict: true,
            schema: z.toJSONSchema(AssessmentSchema),
          },
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              promptVersion: GROQ_PROMPT_VERSION,
              evidence: input.evidence,
              sonicDna: input.sonicDna,
              catalogMetadata: input.catalogMetadata ?? null,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Groq assessment failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq assessment returned no content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Groq assessment returned invalid JSON");
    }

    const result = AssessmentSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Groq assessment schema validation failed: ${result.error.message}`);
    }

    return result.data;
  }
}

export { AssessmentSchema };
