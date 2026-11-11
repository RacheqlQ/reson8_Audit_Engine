import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, GroqClient, GROQ_PROMPT_VERSION } from "../src/providers/groq/client.js";

const long=(s:string,n=65)=>{let v=s;while(v.trim().split(/\s+/).length<n)v+=" "+s;return v;};
const p=(group:string):Record<string,unknown>=>{
 const rationale=long("The supplied evidence supports this limited assessment while important source limitations remain and require verification before any external decision.");
 switch(group){
 case "narrative":return {assessmentVersion:"3.0",executiveSummary:long("This assessment separates supplied track evidence from interpretation and general industry practice. No unsupported audience or commercial claims are made."),creativeIdentity:long("This creative identity description is a provisional interpretation of the supplied evidence and requires full listening review before external use."),strengths:[long("The source record provides a traceable identity field for this assessment."),long("The supplied evidence supports a limited and clearly bounded analysis."),long("The assessment records the outstanding verification requirements.")],risks:[long("No verified audience telemetry is present to establish demand or conversion."),long("Rights and release readiness require independent source verification.")]};
 case "positioning":return {aAndRPositioning:{primaryLane:"R&B",adjacentLanes:["Alternative R&B"],rationale},commercialRead:{marketability:"high",rationale}};
 case "release":return {releaseStrategy:{recommendation:rationale,priorities:[long("Verify master and release identity fields against authoritative source records."),long("Complete a human listening review and document time-coded observations."),long("Collect platform-native performance data before making commercial claims.")] }};
 case "evidence-score":return {evidenceGaps:[long("No verified audience telemetry or conversion evidence was supplied.")],confidence:0.5,limitations:[long("The assessment is limited to the evidence fields supplied for this request.")],scorecard:Object.fromEntries(["tempoLaneFit","rhythmicConsistency","dynamicRangeLoudness","metadataCompleteness","releaseReadiness"].map(k=>[k,{score:k==="dynamicRangeLoudness"?76:k==="metadataCompleteness"?65:k==="releaseReadiness"?55:null,rationale}])),humanListeningChecklist:["Does the opening create a clear reason to continue listening?","Can the hook be recalled after one play and which phrase carries it?","Does the vocal delivery communicate a distinctive point of view?","What feels genuinely original against verified references, and what production details should be checked?","Does the arrangement create development and payoff without excess repetition?","Can a first-time listener describe the lane without prompting, and which audible details support it?"].map(x=>long(x,8)),evidenceLabels:[{label:"INDUSTRY PRACTICE",claim:long("General release craft guidance is separate from claims about this particular recording."),source:"industry_practice"}]};
 case "production":return {productionArrangementGuidance:rationale,industryPractice:rationale,listeningChecks:[long("Check the opening and section transitions against the complete approved master."),long("Review vocal and instrumental balance across dense and sparse sections."),long("Check low-end translation and the ending on multiple playback systems."),long("Record any production observation with a time-coded reference.") ]};
 case "comparables":return {laneHypothesis:rationale,referencesToVerify:[long("Search verified releases for similar arrangement and vocal treatment."),long("Compare tempo feel and sound palette using full recordings."),long("Verify release identity and context before naming a reference.")],verificationMethod:rationale};
 case "promotion":return {promotionPlan:{preRelease:rationale,releaseWindow:rationale,postRelease:rationale,contentIdeas:[long("Create an approved performance excerpt."),long("Prepare a verified artist-story clip."),long("Develop a rights-cleared production breakdown."),long("Test an approved visual motif.")],pitchingAngles:[long("Lead with the verified musical feature that distinguishes the approved recording."),long("Connect the artist story to a specific and source-checked release reason."),long("Frame the track for a relevant lane category without implying acceptance.")],playlistCategories:["Lane-specific R&B discovery","Alternative R&B programming","Mood-led independent discovery"].map(x=>long(x,4)),industryPractice:rationale}};
 case "label-fit":return {labelPartnerFit:{partnerProfile:rationale,criteriaToDemonstrate:[long("Demonstrate a clear artist proposition with approved recordings."),long("Provide complete rights and credits information."),long("Show a consistent creative direction."),long("Document a credible release plan and responsibilities.")],diligenceBeforeContact:rationale,industryPractice:rationale}};
 default:return {executionPlan:{days30:rationale,days60:rationale,days90:rationale}};
 }
};
function fetchMock(invalid?:string){const counts=new Map<string,number>();const mock=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));const name=body.response_format.json_schema.name.replace(/^ar_/,"");const n=(counts.get(name)??0)+1;counts.set(name,n);const value=name===invalid&&n===1?{}:p(name);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});});return {mock,counts};}
describe("GroqClient section groups",()=>{
 it("pins the default Groq model to the workspace model",()=>{
  expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-120b");
 });
 it("passes the completion-token budget on every Groq request",async()=>{
  const {mock}=fetchMock();
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{},sonicDna:null});
  for(const call of mock.mock.calls){
   const body=JSON.parse(String(call[1]?.body));
   expect(body.max_completion_tokens).toBe(8192);
  }
 });
 it("requests and validates all nine Zod section groups with evidence guardrails",async()=>{
  let active=0,maxActive=0;
  const {mock:baseMock}=fetchMock();
  const mock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    active++;maxActive=Math.max(maxActive,active);
    await Promise.resolve();
    const result=await (baseMock as typeof fetch)(url,init);
    active--;return result;
  });
  const client=new GroqClient("test-key",undefined,mock as typeof fetch,async()=>{});
  const result=await client.assess({evidence:{artist:"Fixture Artist"},sonicDna:null});
  expect(mock).toHaveBeenCalledTimes(9);expect(maxActive).toBe(1);expect(result.scorecard.tempoLaneFit.score).toBeNull();expect(result.scorecard.dynamicRangeLoudness.score).toBeNull();expect(result.commercialRead.marketability).toBe("undetermined");expect(result.scorecard.metadataCompleteness.score).toBe(65);expect(result.scorecard.releaseReadiness.score).toBeNull();
  expect(result.evidenceLabels[0].label).toBe("INDUSTRY PRACTICE");expect(result.humanListeningChecklist.length).toBeGreaterThanOrEqual(5);
  expect(result.productionArrangementGuidance).toBeTruthy();expect(result.promotionPlan.playlistCategories.length).toBeGreaterThanOrEqual(3);expect(result.promotionPlan.pitchingAngles.length).toBeGreaterThanOrEqual(3);
  for(const call of mock.mock.calls){const body=JSON.parse(String(call[1]?.body));expect(body.model).toBe(DEFAULT_GROQ_MODEL);expect(body.response_format.type).toBe("json_schema");expect(body.messages[0].content).toContain("Never invent streams");expect(body.messages[1].content).toContain(GROQ_PROMPT_VERSION);}
 });
 it("leaves metadata and release scores null when identity evidence is absent",async()=>{
  const {mock}=fetchMock();const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:null});
  expect(result.scorecard.metadataCompleteness.score).toBeNull();expect(result.scorecard.releaseReadiness.score).toBeNull();
 });
 it("retains dynamic-range scoring only when uploaded-master measurements exist",async()=>{
  const {mock}=fetchMock();const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:{provenance:"uploaded_audio_master",bpm:96,dynamicRangeDb:8.4,loudnessLufs:-9.8}});
  expect(result.scorecard.dynamicRangeLoudness.score).toBe(76);
 });
 it("retries a section once after schema validation fails",async()=>{const {mock,counts}=fetchMock("production");const client=new GroqClient("test-key","test-model",mock as typeof fetch);await client.assess({evidence:{},sonicDna:null});expect(counts.get("production")).toBe(2);expect(mock).toHaveBeenCalledTimes(10);});
 it("gives evidence-score word-count failures an explicit repair instruction",async()=>{
  let evidenceScoreCalls=0;
  const evidenceScorePrompts:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/, "");
   if(group==="evidence-score"){
    evidenceScorePrompts.push(body.messages[0].content+"\\n"+body.messages[1].content);
    evidenceScoreCalls++;
    if(evidenceScoreCalls===1){
     const invalid={...p(group),evidenceGaps:["Missing audience data"]};
     return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200});
    }
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{},sonicDna:null});
  expect(evidenceScoreCalls).toBe(2);
  expect(evidenceScorePrompts[0]).toContain("at least 8 words");
  expect(evidenceScorePrompts[1]).toContain("evidenceGaps[0] must contain at least 8 words");
 });
 it("retries schema-valid output that misses a section word threshold",async()=>{
  const counts=new Map<string,number>();
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
   const n=(counts.get(group)??0)+1;counts.set(group,n);let value=p(group);
   if(group==="production"&&n===1)value={...p(group),productionArrangementGuidance:Array(30).fill("arrangement").join(" ")};
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{},sonicDna:null});
  expect(counts.get("production")).toBe(2);
 });
 it("repairs rhythmicConsistency rationale at the 25-word minimum",async()=>{
  const minimum=["Rhythmic","consistency","requires","uploaded-master","timing","measurements","before","a","reliable","assessment","can","be","made","about","this","recording's","groove","stability","and","temporal","regularity","across","its","musical","sections"].join(" ");
  expect(minimum.trim().split(/\s+/)).toHaveLength(25);
  let evidenceScoreCalls=0;
  const prompts:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/, "");
   let value=p(group);
   if(group==="evidence-score"){
    evidenceScoreCalls++;
    prompts.push(body.messages[0].content+"\n"+body.messages[1].content);
    const rationale=evidenceScoreCalls===1?"Timing is unclear.":minimum;
    const base=p(group) as any;
    value={...base,scorecard:{...base.scorecard,rhythmicConsistency:{...base.scorecard.rhythmicConsistency,rationale}}};
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:{provenance:"uploaded_audio_master"}});
  expect(evidenceScoreCalls).toBe(2);
  expect(prompts[0]).toContain("scorecard.rhythmicConsistency.rationale");
  expect(prompts[0]).toContain("at least 25 words");
  expect(prompts[1]).toContain("scorecard.rhythmicConsistency.rationale must contain at least 25 words");
  expect(result.scorecard.rhythmicConsistency.rationale).toBe(minimum);
 });
 it("honours the provider retry delay in a 429 body and succeeds without losing the request",async()=>{
  let narrativeCalls=0;const sleeps:number[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/, "");
   if(group==="narrative"&&narrativeCalls++===0)return new Response(JSON.stringify({error:{message:"Rate limit reached. Please try again in 13.9725s."}}),{status:429});
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async(ms)=>{sleeps.push(ms);});
  const result=await client.assess({evidence:{},sonicDna:null});
  expect(result.assessmentVersion).toBe("3.0");expect(narrativeCalls).toBe(2);expect(sleeps).toContain(13973);
 });
 it("stops after one retry when a section remains invalid",async()=>{const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));const group=body.response_format.json_schema.name.replace(/^ar_/,"");const value=group==="narrative"?{}:p(group);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});});const client=new GroqClient("test-key","test-model",mock as typeof fetch);await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("failed Zod validation after one retry");expect(mock.mock.calls.filter(c=>JSON.parse(String(c[1]?.body)).response_format.json_schema.name==="ar_narrative")).toHaveLength(2);});

 it("keeps playlist category JSON-schema constraints permissive and retries short category text locally",async()=>{
  let promotionCalls=0;
  const prompts:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
   if(group==="promotion"){
    promotionCalls++;
    const itemSchema=body.response_format.json_schema.schema.properties.promotionPlan.properties.playlistCategories.items;
    expect(itemSchema.minLength??0).toBeLessThanOrEqual(1);
    prompts.push(body.messages[1].content);
    const value=p(group) as any;
    if(promotionCalls===1)value.promotionPlan.playlistCategories=["R&B","Alternative R&B programming","Mood-led independent discovery"];
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:null});
  expect(promotionCalls).toBe(2);
  expect(prompts[1]).toContain("playlistCategories[0]");
  expect(result.promotionPlan.playlistCategories[0].trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
 });

 it("parses Groq retry delays containing minutes and fractional seconds",async()=>{
  let narrativeCalls=0;const sleeps:number[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/, "");
   if(group==="narrative"&&narrativeCalls++===0){
    return new Response(JSON.stringify({error:{message:"Rate limit reached. Please try again in 10m26.4s."}}),{status:429});
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async(ms)=>{sleeps.push(ms);});
  const result=await client.assess({evidence:{},sonicDna:null});
  expect(result.assessmentVersion).toBe("3.0");
  expect(narrativeCalls).toBe(2);
  expect(sleeps).toContain(626400);
 });

});
