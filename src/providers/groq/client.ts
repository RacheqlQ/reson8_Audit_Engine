import { z } from "zod";

export const GROQ_PROMPT_VERSION = "audit-ar-v3";
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

export interface GroqAssessmentInput {
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  catalogMetadata?: Record<string, unknown> | null;
}
export interface GroqAssessmentClient { assess(input: GroqAssessmentInput): Promise<ArAssessment>; }

const SYSTEM_PROMPT = [
  "You are the A&R intelligence analyst for a private music-audit service.",
  "Use only supplied evidence for track-specific claims. Never invent streams, sales, revenue, playlist data, named playlists, curators, demographics, market size, audience metrics, label interest, placements, or external facts.",
  "Evidence classes are strict and mutually distinct: OBSERVED is measured directly from the uploaded audio master only; RECOGNIZED is a claim returned by one named external identification or DSP source; RECONCILED is a field corroborated by at least two independent named providers with no conflict; INFERRED is a clearly labelled hypothesis or interpretation, including all A&R genre, lane, positioning and comparable hypotheses; INDUSTRY PRACTICE is general genre/release craft guidance and is not a fifth evidence tier.",
  "INDUSTRY PRACTICE must be explicitly separated from facts about this track. It may describe typical lane arrangement conventions, release sequencing norms, pitching angles, playlist categories only, content ideas, and label criteria. Never imply those practices were observed in this recording.",
  "Every evidence label must name its actual source. For INFERRED use source groq_assessment to identify an A&R hypothesis, including genre or lane positioning; for INDUSTRY PRACTICE use source industry_practice. Do not label recommendations as observed facts or hypotheses as measurements.",
  "When commercial-performance evidence is absent, marketability must be undetermined. Never infer demand from genre, tempo, catalog popularity or metadata.",
  "A null score means insufficient evidence. Dynamic range/loudness readiness must be null unless an uploaded audio master and its measurements are supplied.",
  "scorecard.rhythmicConsistency.rationale must contain at least 25 words, including when its score is null; explain the specific missing timing evidence in a complete sentence rather than using a short label.",
  "Do not score artistic taste. Hook, originality, production quality, replay value and lane clarity belong only in the unscored human listening checklist. Include a distinct first-listen question for hook recall, originality against verified references, production/arrangement choices, replay impulse and lane clarity.",
  "All recommendations must be specific, actionable and grounded in supplied track evidence or clearly labelled INDUSTRY PRACTICE. Never invent artist/track comparables; give descriptors or search criteria for references to verify.",
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

const MAX_PROVIDER_RETRY_DELAY_MS = 15 * 60_000;
const MAX_NETWORK_ATTEMPTS = 5;
const MAX_COMPLETION_TOKENS = 8192;

async function providerRetryDelayMs(response: Response, fallbackAttempt: number): Promise<number> {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const headerDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(headerDelay) && headerDelay >= 0) {
      return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(headerDelay));
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

  return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, 1000 * (2 ** fallbackAttempt));
}

async function requestGroup<T>(fetchImpl: typeof fetch, apiKey: string, model: string, input: GroqAssessmentInput,
  groupName: string, instructions: string, schema: z.ZodType<T>, sleepImpl:(ms:number)=>Promise<void>): Promise<T> {
  let lastError = "No valid response was returned";
  for(let attempt=0;attempt<2;attempt++){
    let response:Response|null=null;
    for(let networkAttempt=0;networkAttempt<MAX_NETWORK_ATTEMPTS;networkAttempt++){
      response=await fetchImpl("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",headers:{authorization:"Bearer "+apiKey,"content-type":"application/json"},
        body:JSON.stringify({model,temperature:0.1,max_completion_tokens:MAX_COMPLETION_TOKENS,response_format:{type:"json_schema",json_schema:{name:"ar_"+groupName,strict:true,schema:z.toJSONSchema(schema)}},
          messages:[{role:"system",content:SYSTEM_PROMPT+" "+instructions},
            {role:"user",content:JSON.stringify({promptVersion:GROQ_PROMPT_VERSION,sectionGroup:groupName,evidence:input.evidence,
              sonicDna:input.sonicDna,catalogMetadata:input.catalogMetadata??null,correction:attempt===0?null:lastError})}]})
      });
      if(response.ok)break;
      const transient=response.status===429||response.status>=500;
      if(!transient||networkAttempt===MAX_NETWORK_ATTEMPTS-1)break;
      await sleepImpl(await providerRetryDelayMs(response,networkAttempt));
    }
    if(!response||!response.ok){const detail=await response?.text().catch(()=>"")??"";throw new Error("Groq "+groupName+" assessment failed with HTTP "+(response?.status??"unknown")+(detail?": "+detail.slice(0,300):""));}
    const payload=await response.json() as {choices?:Array<{message?:{content?:string|null}}>};
    const content=payload.choices?.[0]?.message?.content;
    if(!content){lastError="The response contained no JSON content.";continue;}
    let parsed:unknown;try{parsed=JSON.parse(content);}catch{lastError="The response was not valid JSON.";continue;}
    const result=schema.safeParse(parsed);if(!result.success){lastError=result.error.message;continue;}
    const wordError=thresholdError(groupName,result.data);if(wordError){lastError=wordError;continue;}
    return result.data;
  }
  throw new Error("Groq "+groupName+" response failed Zod validation after one retry: "+lastError);
}

export class GroqClient implements GroqAssessmentClient {
  private readonly apiKey:string; private readonly model:string; private readonly fetchImpl:typeof fetch; private readonly sleepImpl:(ms:number)=>Promise<void>;
  constructor(apiKey=process.env.GROQ_API_KEY??process.env.GROQ_API,model=process.env.GROQ_MODEL??DEFAULT_GROQ_MODEL,fetchImpl:typeof fetch=fetch,sleepImpl:(ms:number)=>Promise<void>=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))){
    if(!apiKey)throw new Error("GROQ_API is required");this.apiKey=apiKey;this.model=model;this.fetchImpl=fetchImpl;this.sleepImpl=sleepImpl;
  }
  async assess(input:GroqAssessmentInput):Promise<ArAssessment>{
    const tasks=[
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"narrative","Write the executive assessment, identity, strengths and risks.",NarrativeSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"positioning","Write evidence-bounded A&R positioning and commercial read.",PositioningSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"release","Write a grounded release recommendation and priorities.",ReleaseSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"evidence-score","Score only evidence-derivable dimensions. Return the unscored human listening checklist. Every evidenceGaps item and every limitations item must contain at least 8 words. Every scorecard rationale must contain at least 25 words. In particular, scorecard.rhythmicConsistency.rationale needs at least 25 words even for a null score; state which uploaded-master timing evidence is missing in a complete sentence. Every humanListeningChecklist item must contain at least 5 words. Do not use fragments or short labels; write complete, specific sentences. If the correction field identifies a word-count failure, repair that exact field while preserving the evidence-bounded meaning.",EvidenceScoreSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"production","Give actionable production and arrangement guidance. Separate lane-general craft as INDUSTRY PRACTICE.",ProductionSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"comparables","Provide inferred lane descriptors and reference-search criteria to verify; do not invent named artists or tracks.",ComparableSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"promotion","Build a staged promotion plan, general pitching angles, content concepts and playlist categories only. Each playlist category must be a descriptive phrase of at least three words. Include INDUSTRY PRACTICE separately.",PromotionSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"label-fit","Describe category-level partner fit and evidence criteria; no claims of label interest. Include INDUSTRY PRACTICE separately.",LabelFitSchema,this.sleepImpl),
      ()=>requestGroup(this.fetchImpl,this.apiKey,this.model,input,"timeline","Build actionable 30/60/90-day steps without inventing dates, budgets or targets.",TimelineSchema,this.sleepImpl)
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
    if(!audioMaster || typeof dna?.dynamicRangeDb!=="number" || typeof dna?.loudnessLufs!=="number"){
      assembled.scorecard.dynamicRangeLoudness={score:null,rationale:"Dynamic range and loudness readiness require numeric measurements from an uploaded audio master. Those measurements are absent or not master-derived in this assessment, so this dimension remains unscored for this specific recording."};
    }
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
    return combined.data;
  }
}
export { AssessmentSchema, EvidenceLabelSchema };
