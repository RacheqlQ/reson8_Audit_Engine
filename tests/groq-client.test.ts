import { describe, expect, it, vi } from "vitest";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { DEFAULT_GROQ_MODEL, GeminiClient, GroqClient, OllamaClient, GROQ_PROMPT_VERSION, GROQ_ASSESSMENT_TIMEOUT_MS, GEMINI_ASSESSMENT_TIMEOUT_MS, OLLAMA_ASSESSMENT_TIMEOUT_MS, type ProviderAttemptDiagnostic } from "../src/providers/groq/client.js";
import { sharedGroqTokenLimiter } from "../src/providers/token-per-minute-limiter.js";
import { clearAssessmentProviderUnavailable, getAssessmentProviderReadiness } from "../src/providers/provider-policy.js";

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
 it("spells out the narrative minimums and corrects an under-length strengths array",async()=>{
  let narrativeCalls=0;
  const narrativePayloads:Array<Record<string,any>>=[];
  let narrativeSystem="";
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const payload=JSON.parse(body.messages[1].content);
   if(payload.sectionGroup==="narrative"){
    narrativeCalls++;
    narrativeSystem=body.messages[0].content;
    narrativePayloads.push(payload);
    if(narrativeCalls===1){
     const invalid=p("narrative");
     invalid.strengths=(invalid.strengths as string[]).slice(0,2);
     return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200});
    }
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
  });
  const client=new GeminiClient("test-gemini-key","test-model",mock as typeof fetch,async()=>{});
  const result=await client.assess({evidence:{artist:"Fixture Artist"},sonicDna:null});
  expect(narrativeSystem).toContain("at least 3 distinct evidence-grounded strengths");
  expect(narrativeSystem).toContain("at least 2 distinct evidence-grounded risks");
  expect(narrativeCalls).toBe(2);
  expect(narrativePayloads[1].correction).toContain("strengths");
  expect(result.strengths).toHaveLength(3);
 });
 it("keeps production provider fallback deadlines inside the eleven-minute assessment stage",()=>{
  expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBe(7*60_000);
  expect(GEMINI_ASSESSMENT_TIMEOUT_MS).toBe(3*60_000);
  expect(OLLAMA_ASSESSMENT_TIMEOUT_MS).toBe(2*60_000);
  expect(GROQ_ASSESSMENT_TIMEOUT_MS+GEMINI_ASSESSMENT_TIMEOUT_MS+60_000).toBeLessThanOrEqual(11*60_000);
  expect(OLLAMA_ASSESSMENT_TIMEOUT_MS).toBeLessThan(11*60_000);
 });
 it("uses the bounded provider-specific deadline defaults",async()=>{
  const groqController=new AbortController();
  const groqFetch=vi.fn(async()=>{groqController.abort();throw new Error("captured");});
  await expect(new GroqClient("groq-key",undefined,groqFetch as typeof fetch).assess({evidence:{},sonicDna:null},groqController.signal)).rejects.toThrow("captured");
  const geminiController=new AbortController();
  const geminiFetch=vi.fn(async()=>{geminiController.abort();throw new Error("captured");});
  await expect(new GeminiClient("gemini-key",undefined,geminiFetch as typeof fetch).assess({evidence:{},sonicDna:null},geminiController.signal)).rejects.toThrow("captured");
  const ollamaController=new AbortController();
  const ollamaFetch=vi.fn(async()=>{ollamaController.abort();throw new Error("captured");});
  await expect(new OllamaClient("ollama-key",undefined,ollamaFetch as typeof fetch).assess({evidence:{},sonicDna:null},ollamaController.signal)).rejects.toThrow("captured");
 });
 it("removes high-volume Sonic DNA diagnostic arrays from repeated Groq prompts while preserving useful measurements",async()=>{
  const {mock}=fetchMock();
  const sonicDna={
   provenance:"uploaded_audio_master",evidenceClass:"OBSERVED",bpm:95,tempoConfidence:0.82,
   key:"A",mode:"minor",moodTags:["Moderate Energy","Bright Timbre"],
   rhythmFeatures:{
    status:"measured",bpm:95,confidence:0.82,method:"high_frequency_transient_autocorrelation",
    candidateBpms:[95,63,76],candidateScores:[{bpm:95,score:0.35}],
    onsetEnvelope:Array.from({length:128},(_,index)=>index/128),
    beatTimesSeconds:Array.from({length:512},(_,index)=>index*0.32),
    downbeatCandidateTimesSeconds:Array.from({length:128},(_,index)=>index*1.28),
    beatGridStatus:"tentative",abstentionReason:null,
   },
   harmonicFeatures:{
    status:"measured",key:"A",mode:"minor",confidence:0.71,segmentAgreement:0.62,
    tuningCents:1.2,analysisWindows:8,fftButterflyCount:1000,
    segmentChroma:Array.from({length:8},()=>Array.from({length:12},(_,index)=>index/12)),
   },
  };
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{artist:"Fixture Artist",rawProviderPayload:{huge:Array(100).fill("provider-only payload")},catalogId:"private-id"},sonicDna});
  const payloads=mock.mock.calls.map(call=>{
   const body=JSON.parse(String(call[1]?.body));
   return JSON.parse(body.messages[1].content);
  });
  const narrative=payloads.find(payload=>payload.sectionGroup==="narrative");
  const evidenceScore=payloads.find(payload=>payload.sectionGroup==="evidence-score");
  expect(narrative.evidence).toMatchObject({artist:"Fixture Artist"});
  expect(narrative.evidence).not.toHaveProperty("rawProviderPayload");
  expect(narrative.evidence).not.toHaveProperty("catalogId");
  expect(evidenceScore.sonicDna).toMatchObject({
   provenance:"uploaded_audio_master",bpm:95,tempoConfidence:0.82,key:"A",mode:"minor",
   rhythmFeatures:{status:"measured",bpm:95,confidence:0.82,candidateBpms:[95,63,76]},
   harmonicFeatures:{status:"measured",key:"A",mode:"minor",segmentAgreement:0.62},
  });
  expect(evidenceScore.sonicDna.rhythmFeatures).not.toHaveProperty("onsetEnvelope");
  expect(evidenceScore.sonicDna.rhythmFeatures).not.toHaveProperty("beatTimesSeconds");
  expect(evidenceScore.sonicDna.rhythmFeatures).not.toHaveProperty("downbeatCandidateTimesSeconds");
  expect(evidenceScore.sonicDna.harmonicFeatures).not.toHaveProperty("segmentChroma");
  expect(JSON.stringify(evidenceScore.sonicDna).length).toBeLessThan(JSON.stringify(sonicDna).length * 0.7);
  expect(mock.mock.calls).toHaveLength(9);
  expect(narrative.sonicDna).not.toHaveProperty("rhythmFeatures");
  expect(narrative.sonicDna).not.toHaveProperty("harmonicFeatures");
  expect(payloads.find(payload=>payload.sectionGroup==="production").sonicDna).toHaveProperty("rhythmFeatures");
 });

 it("projects Sonic DNA and catalog metadata to the assessment section that can use them", async () => {
  const sonicDna = {
   provenance:"uploaded_audio_master", evidenceClass:"OBSERVED", bpm:95, tempoConfidence:0.82,
   key:"A", mode:"minor", keyConfidence:0.91, keyCandidates:[{key:"A",mode:"minor",score:0.88}],
   moodTags:["Moderate Energy"], genreContext:["Contemporary R&B"],
   limitations:["Tempo confidence is provisional pending listening review."],
   tonalResolution:{status:"CONFIRMED",tonic:"A",mode:"minor",candidates:[{tonic:"A",mode:"minor",score:0.88}]},
   vocalArrangementAnalysis:{status:"analyzed",sections:[{label:"verse",startSeconds:0,endSeconds:12}]},
   genreClassification:{primaryGenre:"R&B"},
   rhythmFeatures:{status:"measured",bpm:95,onsetEnvelope:Array(100).fill(0.1)},
   harmonicFeatures:{status:"measured",key:"A",segmentChroma:Array(100).fill(0.1)},
   acousticFeatureProfile:{predictions:{energy:{status:"provisional",score:62}}},
   vocalFeatures:{status:"analyzed",activity:0.7},
   vocalArrangementAnalysis:{status:"analyzed",sections:[{label:"verse",startSeconds:0,endSeconds:12}]},
   dynamicRangeDb:8.2, rmsLevelDbfs:-12, sampleRate:44100, channels:2,
   privateRawWaveform:Array(1000).fill(0.2),
  };
  const catalogMetadata={apple_music:{title:"Track",isrc:"USAAA2600001"},spotify:{artist:"Artist"}};
  const {mock}=fetchMock();
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{artist:"Artist",title:"Track"},sonicDna,catalogMetadata});
  const payloads=mock.mock.calls.map(call=>{
   const body=JSON.parse(String(call[1]?.body));
   return JSON.parse(body.messages[1].content);
  });
  const byGroup=new Map(payloads.map(payload=>[payload.sectionGroup,payload]));
  const evidence=byGroup.get("evidence-score") as Record<string,any>;
  expect(evidence.sonicDna).toMatchObject({
   rhythmFeatures:{status:"measured",bpm:95},
   harmonicFeatures:{status:"measured",key:"A"},
   keyCandidates:[{key:"A",mode:"minor",score:0.88}],
   moodTags:["Moderate Energy"], genreContext:["Contemporary R&B"],
   limitations:["Tempo confidence is provisional pending listening review."],
   tonalResolution:{status:"CONFIRMED",tonic:"A",mode:"minor"},
   vocalArrangementAnalysis:{status:"analyzed",sections:[{label:"verse",startSeconds:0,endSeconds:12}]},
   acousticFeatureProfile:{predictions:{energy:{status:"provisional",score:62}}},
   vocalFeatures:{status:"analyzed",activity:0.7},
   dynamicRangeDb:8.2, sampleRate:44100,
  });
  expect(evidence.sonicDna).not.toHaveProperty("privateRawWaveform");
  expect(evidence.catalogMetadata).toEqual(catalogMetadata);
  const timeline=byGroup.get("timeline") as Record<string,any>;
  expect(timeline.sonicDna).toMatchObject({provenance:"uploaded_audio_master",genreClassification:{primaryGenre:"R&B"}});
  expect(timeline.sonicDna).not.toHaveProperty("rhythmFeatures");
  expect(timeline.catalogMetadata).toBeNull();
  const production=byGroup.get("production") as Record<string,any>;
  expect(production.sonicDna).toHaveProperty("rhythmFeatures");
  expect(production.sonicDna).toHaveProperty("vocalFeatures");
  expect(production.catalogMetadata).toBeNull();
 });
 it("records sanitized provider attempt diagnostics without prompt or credential material",async()=>{
  const {mock}=fetchMock();
  const attempts:Array<Record<string,unknown>>=[];
  const client=new GroqClient("secret-test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{privatePrompt:"do not persist"},sonicDna:null,recordProviderAttempt:async(attempt)=>{attempts.push(attempt);}});
  expect(attempts).toHaveLength(9);
  expect(attempts[0]).toMatchObject({provider:"groq",model:"test-model",status:200,errorType:"none",retryable:false,attempt:1});
  expect(JSON.stringify(attempts)).not.toContain("secret-test-key");
  expect(JSON.stringify(attempts)).not.toContain("privatePrompt");
 });
 it("uses the current Gemini Flash Lite model and OpenAI-compatible JSON contract",async()=>{
  let capturedUrl="";
  let capturedInit:RequestInit|undefined;
  const controller=new AbortController();
  const mock=vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>{
   capturedUrl=String(url);capturedInit=init;controller.abort();throw new Error("test-stop-after-request-capture");
  });
  const client=new GeminiClient("test-gemini-key",undefined,mock as typeof fetch);
  await expect(client.assess({evidence:{},sonicDna:null},controller.signal)).rejects.toThrow("test-stop-after-request-capture");
  const body=JSON.parse(String(capturedInit?.body));
  expect(capturedUrl).toContain("/v1beta/openai/chat/completions");
  expect((capturedInit?.headers as Record<string,string>).authorization).toBe("Bearer test-gemini-key");
  expect(body.model).toBe("gemini-3.5-flash-lite");
  expect(body.response_format).toEqual({type:"json_object"});
  expect(JSON.stringify(body.messages[0].content)).toContain("outputSchema");
 });
 it("passes the completion-token budget on every Groq request",async()=>{
  const {mock}=fetchMock();
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence:{},sonicDna:null});
  for(const call of mock.mock.calls){
   const body=JSON.parse(String(call[1]?.body));
   const estimatedInputBytes=Math.ceil(new TextEncoder().encode(JSON.stringify({messages:body.messages,response_format:body.response_format})).length/2)+256;
   expect(body.max_completion_tokens).toBeGreaterThanOrEqual(256);
   expect(body.max_completion_tokens).toBeLessThanOrEqual(2000);
   expect(estimatedInputBytes+body.max_completion_tokens).toBeLessThanOrEqual(6000);
  }
 });
 it("keeps production-shaped assessment evidence under the Groq 6,000-token request ceiling",async()=>{
  const evidence={
   auditType:"full_a_and_r",artist:"Fixture Artist",title:"Evidence-rich single release",
   releaseDate:"2026-10-18",label:"Independent",isrc:"USAAA2600001",upc:"198765432109",
   genres:["Contemporary R&B","Alternative R&B"],
   sourceProviders:["musicbrainz","spotify","apple_music","youtube"],
   fieldProvenance:Object.fromEntries(Array.from({length:14},(_,index)=>["field"+index,{
    source:["musicbrainz","spotify","apple_music"][index%3],
    status:"recognized",confidence:0.82,detail:"Provider-returned identity and release evidence retained for reconciliation."
   }])),
   identity:{artist:"Fixture Artist",title:"Evidence-rich single release",isrc:"USAAA2600001",matchStatus:"reconciled"},
   reconciliation:{status:"partial",conflicts:["Release date differs between two provider records."],matchedFields:["artist","title","isrc"]},
   genreClassification:{genres:["Contemporary R&B"],primaryGenre:"Contemporary R&B",abstained:false},
   catalogSources:["musicbrainz","spotify","apple_music"],
   commercialEvidence:{status:"not_supplied",reason:"No authenticated platform analytics were connected."},
   commercialPerformance:{streams:null,saveRate:null,source:"not_supplied"},
   audienceTelemetry:{status:"unavailable",platformsChecked:["spotify","youtube"]},
   rightsStatus:{status:"unverified",notes:"Independent rights documentation is required."},
   releaseStatus:{status:"released",releaseDate:"2026-10-18"}
  };
  const sonicDna={
   provenance:"uploaded_audio_master",evidenceClass:"OBSERVED",analysisVersion:"sonic-dna-v1",
   sourceProviders:["essentia","musicbrainz"],confidence:0.82,warnings:["Mood descriptors remain provisional."],
   bpm:95,tempoConfidence:0.82,key:"A",mode:"minor",moodTags:["Moderate Energy"],
   genreTags:["Contemporary R&B"],genreContext:["Contemporary R&B"],
   limitations:["Tempo confidence is provisional pending human listening review."],
   keyCandidates:[{key:"A",mode:"minor",score:0.88}],
   genreClassification:{primaryGenre:"Contemporary R&B",genres:["Contemporary R&B"],abstained:false},
   tonalResolution:{status:"CONFIRMED",tonic:"A",mode:"minor",confidence:0.88},
   rhythmFeatures:{status:"measured",bpm:95,confidence:0.82,candidateBpms:[95,63,76],windowConsensus:0.78},
   harmonicFeatures:{status:"measured",key:"A",mode:"minor",confidence:0.88,segmentAgreement:0.82},
   acousticFeatureProfile:{predictions:{mood:{status:"provisional",labels:["reflective"]},energy:{status:"provisional",score:62}}},
   vocalFeatures:{status:"analyzed",activity:0.7,pitchMedianHz:184},
   dynamicRangeDb:8.2,rmsLevelDbfs:-12,sampleRate:44100,channels:2,durationSeconds:198
  };
  const catalogMetadata={
   musicbrainz:{status:"matched",artistCredit:"Fixture Artist",recordingTitle:"Evidence-rich single release",releaseDate:"2026-10-18"},
   spotify:{status:"matched",artist:"Fixture Artist",track:"Evidence-rich single release",isrc:"USAAA2600001"},
   apple_music:{status:"matched",artist:"Fixture Artist",title:"Evidence-rich single release"},
   youtube:{status:"checked",officialArtistChannel:true},
   reconciliation:{status:"partial",conflicts:["Release date requires manual verification."]}
  };
  const {mock}=fetchMock();
  const evidenceScorePayloads:Array<Record<string,any>>=[];
  mock.mockImplementation(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const payload=JSON.parse(body.messages[1].content);
   if(payload.sectionGroup==="evidence-score") evidenceScorePayloads.push(payload);
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  await client.assess({evidence,sonicDna,catalogMetadata});
  expect(mock).toHaveBeenCalledTimes(9);
  expect(evidenceScorePayloads).toHaveLength(1);
  expect(evidenceScorePayloads[0].evidence).toMatchObject({
   sourceProviders:["musicbrainz","spotify","apple_music","youtube"],
   genreClassification:{primaryGenre:"Contemporary R&B",genres:["Contemporary R&B"]}
  });
  expect(evidenceScorePayloads[0].evidence).not.toHaveProperty("genres");
  expect(evidenceScorePayloads[0].evidence).not.toHaveProperty("catalogSources");
  expect(evidenceScorePayloads[0].evidence).toMatchObject({
   identity:{artist:"Fixture Artist",isrc:"USAAA2600001"},
   reconciliation:{status:"partial"},
   fieldProvenance:expect.objectContaining({field0:expect.objectContaining({source:"musicbrainz"})})
  });
  expect(evidenceScorePayloads[0].catalogMetadata).toBeNull();
  for(const call of mock.mock.calls){
   const body=JSON.parse(String(call[1]?.body));
   const estimatedInputTokens=Math.ceil(new TextEncoder().encode(JSON.stringify({messages:body.messages,response_format:body.response_format})).length/2)+256;
   expect(estimatedInputTokens).toBeGreaterThan(256);
   expect(body.max_completion_tokens).toBeGreaterThanOrEqual(256);
   expect(estimatedInputTokens+body.max_completion_tokens).toBeLessThanOrEqual(6000);
  }
 });
 it("bounds oversized catalog metadata before sending a Groq request",async()=>{
  const oversizedCatalog=Object.fromEntries(Array.from({length:40},(_,index)=>[
   "provider"+index,"catalog evidence detail ".repeat(60)
  ]));
  const {mock}=fetchMock();
  const payloads:Array<Record<string,any>>=[];
  mock.mockImplementation(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const payload=JSON.parse(body.messages[1].content);
   if(payload.sectionGroup==="narrative")payloads.push(payload);
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await client.assess({
   evidence:{artist:"Fixture Artist",title:"Oversized metadata fixture"},
   sonicDna:null,catalogMetadata:oversizedCatalog
  });
  expect(mock).toHaveBeenCalledTimes(9);
  expect(payloads).toHaveLength(1);
  expect(Object.keys(payloads[0].catalogMetadata)).toHaveLength(4);
  expect(payloads[0].catalogMetadata.provider0.length).toBeLessThanOrEqual(212);
 });
 it("keeps Gemini and Ollama module output budgets independent of Groq's TPM ceiling",async()=>{
  const identity=Object.fromEntries(Array.from({length:20},(_,index)=>["sourceField"+index,"verified source provenance detail ".repeat(25)]));
  for(const provider of ["gemini","ollama"] as const){
   const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const payload=JSON.parse(body.messages[1].content);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
   });
   const client=provider==="gemini"
    ? new GeminiClient("test-gemini-key","test-model",mock as typeof fetch,async()=>{})
    : new OllamaClient("test-ollama-key","test-model",mock as typeof fetch,async()=>{});
   await client.assess({evidence:{identity},sonicDna:null});
   const evidenceScoreCall=mock.mock.calls.find(call=>{
    const body=JSON.parse(String(call[1]?.body));
    return JSON.parse(body.messages[1].content).sectionGroup==="evidence-score";
   });
   expect(evidenceScoreCall).toBeDefined();
   const evidenceScoreBody=JSON.parse(String(evidenceScoreCall?.[1]?.body));
   expect(evidenceScoreBody.max_tokens).toBe(1000);
  }
 });
 it("classifies exhausted Groq JSON-schema rejection as malformed output",async()=>{
  const mock=vi.fn(async()=>new Response(JSON.stringify({error:{message:"Failed to validate JSON",code:"json_validate_failed"}}),{status:400}));
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("json_validate_failed:");
  // One strict attempt, then bounded JSON-object and prompt-only recovery.
  expect(mock).toHaveBeenCalledTimes(5);
 });
 it("treats HTTP 413 as permanent and never retries the same request payload",async()=>{
  let calls=0;
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
   if(group==="narrative"&&calls++===0)return new Response(JSON.stringify({error:{message:"Request too large for model in organization on tokens per minute (TPM): Limit 8000, Requested 8289."}}),{status:413});
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("GROQ_REQUEST_TOO_LARGE");
  expect(calls).toBe(1);
  expect(mock).toHaveBeenCalledTimes(1);
 });
 it("fails fast on a Groq tokens-per-day limit without sleeping or retrying",async()=>{
  let calls=0;const sleeps:number[]=[];
  const mock=vi.fn(async()=>{calls++;return new Response(JSON.stringify({error:{message:"Rate limit reached: tokens per day (TPD) limit exceeded. Try again tomorrow."}}),{status:429});});
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async(ms)=>{sleeps.push(ms);});
  await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("AI capacity reached for now, please try again later");
  expect(calls).toBe(1);expect(sleeps).toEqual([]);
 });
 it("resumes validated completed section groups without another provider request",async()=>{
  const saved:string[]=[];const requested:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
   requested.push(group);
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await client.assess({
   evidence:{},sonicDna:null,
   loadCompletedSectionGroup:async(group)=>group==="narrative"?p("narrative"):null,
   saveCompletedSectionGroup:async(group)=>{saved.push(group);},
  });
  expect(requested).not.toContain("narrative");
  expect(requested).toHaveLength(8);
  expect(saved).toHaveLength(8);
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
  expect(mock).toHaveBeenCalledTimes(9);expect(maxActive).toBe(1);expect(result.scorecard.tempoLaneFit.score).toBeNull();expect(result.scorecard.dynamicRangeLoudness.score).toBeNull();expect(result.commercialRead.marketability).toBe("undetermined");expect(result.scorecard.metadataCompleteness.score).toBeNull();expect(result.scorecard.releaseReadiness.score).toBeNull();
  expect(result.evidenceLabels[0].label).toBe("INDUSTRY PRACTICE");expect(result.humanListeningChecklist.length).toBeGreaterThanOrEqual(5);
  expect(result.productionArrangementGuidance).toBeTruthy();expect(result.promotionPlan.playlistCategories.length).toBeGreaterThanOrEqual(3);expect(result.promotionPlan.pitchingAngles.length).toBeGreaterThanOrEqual(3);
  expect(result.generationProvenance).toMatchObject({provider:"groq",model:DEFAULT_GROQ_MODEL,promptVersion:GROQ_PROMPT_VERSION});expect(result.generationProvenance.fieldGroups.executiveSummary).toBe("narrative");expect(result.generationProvenance.fieldGroups.scorecard).toBe("evidence-score");expect(result.generationProvenance.fieldGroups.executionPlan).toBe("timeline");expect(Number.isNaN(Date.parse(result.generationProvenance.generatedAt))).toBe(false);
  for(const call of mock.mock.calls){const body=JSON.parse(String(call[1]?.body));expect(body.model).toBe(DEFAULT_GROQ_MODEL);expect(body.response_format.type).toBe("json_schema");expect(body.messages[0].content.toLowerCase()).toContain("never invent streams");expect(body.messages[1].content).toContain(GROQ_PROMPT_VERSION);}
 });
 it("leaves metadata and release scores null when identity evidence is absent",async()=>{
  const {mock}=fetchMock();const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:null});
  expect(result.scorecard.metadataCompleteness.score).toBeNull();expect(result.scorecard.releaseReadiness.score).toBeNull();
 });
 it("withholds technical delivery-readiness scoring without destination-specific targets",async()=>{
  const {mock}=fetchMock();const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:{provenance:"uploaded_audio_master",bpm:96,dynamicRangeDb:8.4,rmsLevelDbfs:-12.0}});
  expect(result.scorecard.dynamicRangeLoudness.score).toBeNull();
  expect(result.scorecard.dynamicRangeLoudness.rationale).toContain("destination-specific");
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
  expect(evidenceScorePrompts[0]).toContain("evidenceGaps>=1 items, each>=8 words");
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
    const rationale=evidenceScoreCalls===1?"The supplied timing evidence remains incomplete and does not support a reliable judgment about groove stability or temporal regularity.":minimum;
    const base=p(group) as any;
    value={...base,scorecard:{...base.scorecard,rhythmicConsistency:{...base.scorecard.rhythmicConsistency,rationale}}};
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch);
  const result=await client.assess({evidence:{},sonicDna:{provenance:"uploaded_audio_master",bpm:120,tempoConfidence:0.8}});
  expect(evidenceScoreCalls).toBe(2);
  expect(prompts[0]).toContain("scorecard.rhythmicConsistency.rationale");
  expect(prompts[0]).toContain(">=25 words");
  expect(prompts[1]).toContain("scorecard.rhythmicConsistency.rationale>=25 words");
  expect(result.scorecard.rhythmicConsistency.rationale.split(/\s+/).length).toBeGreaterThanOrEqual(25);
   expect(result.scorecard.rhythmicConsistency.rationale).toContain("Not scored:");
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
  expect(result.assessmentVersion).toBe("3.0");expect(narrativeCalls).toBe(2);expect(sleeps[0]).toBeGreaterThanOrEqual(13973);expect(sleeps[0]).toBeLessThanOrEqual(16768);
 });
 it("retries Groq provider-side JSON schema validation failures with provider error details as correction context",async()=>{
  let evidenceScoreCalls=0;
  const prompts:string[]=[];
  const systemPrompts:string[]=[];
  const responseFormats:string[]=[];
  const payloads:Array<Record<string,unknown>>=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),userPayload=JSON.parse(body.messages[1].content),group=userPayload.sectionGroup;
   if(group==="evidence-score"){
    evidenceScoreCalls++;
    prompts.push(body.messages[1].content);
    responseFormats.push(body.response_format.type);
    payloads.push(userPayload);
    systemPrompts.push(body.messages[0].content);
    if(body.response_format.type==="json_schema"){
     expect(body.response_format.json_schema.strict).toBe(true);
     expect(body.response_format.json_schema.schema.required).toContain("evidenceLabels");
    }
    if(evidenceScoreCalls<=2){
     return new Response(JSON.stringify({error:{
      message:"Failed to validate JSON. Please adjust your prompt.",
      type:"invalid_request_error",
      code:"json_validate_failed",
      failed_generation:""
     }}),{status:400});
    }
    if(evidenceScoreCalls===3){
     return new Response(JSON.stringify({choices:[{message:{content:"{}"}}]}),{status:200});
    }
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  const result=await client.assess({evidence:{artist:"Regression Artist",title:"Regression Track"},sonicDna:{provenance:"uploaded_audio_master",bpm:96},catalogMetadata:{apple_music:{title:"Regression Track",isrc:"USAAA2600001"}}});
  expect(evidenceScoreCalls).toBe(4);
  expect(prompts[1]).toContain("strict JSON-schema validation failed");
  expect(prompts[1]).toContain("evidenceLabels");
  expect(systemPrompts[0]).toContain("Always include the evidenceLabels array");
  expect(responseFormats).toEqual(["json_schema","json_object","json_object","json_object"]);
  expect(payloads[0].evidence).toEqual(payloads[1].evidence);
  expect(payloads[1].evidence).toEqual(payloads[2].evidence);
  expect(payloads[2].evidence).toEqual(payloads[3].evidence);
  expect(prompts[3]).toContain("evidenceGaps");
  expect(payloads[0].sonicDna).toEqual(payloads[2].sonicDna);
  expect(payloads[0].catalogMetadata).toEqual(payloads[2].catalogMetadata);
  expect(result.evidenceLabels).toHaveLength(1);
 });
 it("does not retry unrelated non-transient Groq HTTP 400 errors",async()=>{
  let calls=0;
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
   if(group==="narrative"&&calls++===0)return new Response(JSON.stringify({error:{message:"Invalid API key",code:"invalid_api_key"}}),{status:400});
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("Groq narrative assessment failed with HTTP 400");
  expect(calls).toBe(1);
 });
 it("exhausts structured-output recovery modes when a section remains invalid",async()=>{const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));const group=JSON.parse(body.messages[1].content).sectionGroup;const value=group==="narrative"?{}:p(group);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});});const client=new GroqClient("test-key","test-model",mock as typeof fetch);await expect(client.assess({evidence:{},sonicDna:null})).rejects.toThrow("failed validation after bounded recovery");expect(mock.mock.calls.filter(c=>JSON.parse(JSON.parse(String(c[1]?.body)).messages[1].content).sectionGroup==="narrative")).toHaveLength(8);});

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
  expect(sleeps).toContain(60_000);
 });

 it("exhausts structured-output recovery modes when evidenceGaps remains below eight words",async()=>{
  let evidenceScoreCalls=0;
  const prompts:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=JSON.parse(body.messages[1].content).sectionGroup;
   if(group==="evidence-score"){
    evidenceScoreCalls++;
    prompts.push(body.messages[1].content);
    const invalid={...p(group),evidenceGaps:["Missing audience data"]};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200});
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(group))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await expect(client.assess({evidence:{},sonicDna:null}))
   .rejects.toThrow("Groq evidence-score response failed validation after bounded recovery");
  expect(evidenceScoreCalls).toBe(8);
  expect(prompts[1]).toContain("evidenceGaps[0] must contain at least 8 words");
 });

 it("bounds production-sized provenance and vocal timelines without breaching Groq's 6,000-token request ceiling",async()=>{
  const detail="Provider-returned reconciliation commentary with repeated raw source context that is not needed to preserve the actual source, status, confidence or normalized field value. ".repeat(8);
  const fieldProvenance=Object.fromEntries(Array.from({length:48},(_,index)=>["field"+index,{
   source:["musicbrainz","spotify","apple_music"][index%3],status:"recognized",confidence:0.82,
   value:"normalized identity value "+index,detail,rawPayload:detail
  }]));
  const evidence={
   auditType:"full_a_and_r",artist:"Fixture Artist",title:"Production-sized evidence fixture",
   sourceProviders:["musicbrainz","spotify","apple_music","youtube"],fieldProvenance,
   identity:{artist:"Fixture Artist",title:"Production-sized evidence fixture",isrc:"USAAA2600001",matchStatus:"reconciled"},
   reconciliation:{status:"partial",matchedFields:["artist","title","isrc"],conflicts:Array.from({length:40},(_,index)=>"Conflict "+index+": "+detail)},
   genreClassification:{primaryGenre:"Contemporary R&B",genres:["Contemporary R&B"],abstained:false},
   commercialEvidence:{verified:false,reason:detail},rightsStatus:{status:"unverified",notes:detail}
  };
  const sonicDna={
   provenance:"uploaded_audio_master",evidenceClass:"OBSERVED",analysisVersion:"sonic-dna-v1",
   sourceProviders:["essentia"],confidence:0.82,warnings:[detail],limitations:[detail],
   bpm:95,tempoConfidence:0.82,key:"A",mode:"minor",moodTags:["reflective"],genreTags:["Contemporary R&B"],
   genreClassification:{primaryGenre:"Contemporary R&B",genres:["Contemporary R&B"],abstained:false},
   vocalArrangementAnalysis:{status:"analyzed",segments:Array.from({length:60},(_,index)=>({
    startSeconds:index*3,endSeconds:(index+1)*3,role:index%2?"lead":"backing",description:detail
   }))}
  };
  const catalogMetadata=Object.fromEntries(Array.from({length:32},(_,index)=>["provider"+index,{
   status:"matched",source:"catalog provider "+index,detail
  }]));
  const {mock}=fetchMock();
  const requests:Array<{group:string;payload:Record<string,any>;total:number}>=[];
  mock.mockImplementation(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const payload=JSON.parse(body.messages[1].content);
   const estimated=Math.ceil(new TextEncoder().encode(JSON.stringify({messages:body.messages,response_format:body.response_format})).length/2)+256;
   requests.push({group:payload.sectionGroup,payload,total:estimated+body.max_completion_tokens});
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
  });
  const client=new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{});
  await client.assess({evidence,sonicDna,catalogMetadata});
  expect(requests).toHaveLength(9);
  expect(requests.every(request=>request.total<=6000)).toBe(true);
  const narrative=requests.find(request=>request.group==="narrative")!;
  expect(narrative.payload.sonicDna).not.toHaveProperty("vocalArrangementAnalysis");
  expect(Object.keys(narrative.payload.evidence.fieldProvenance)).toHaveLength(12);
  expect(narrative.payload.evidence.fieldProvenance.field0).not.toHaveProperty("detail");
  const evidenceScore=requests.find(request=>request.group==="evidence-score")!;
  expect(evidenceScore.payload.sonicDna.vocalArrangementAnalysis.segments).toHaveLength(4);
 });

});



describe("narrative prompt budget compaction",()=>{
 it("keeps production-sized uploaded-master narrative context below the Groq TPM ceiling without dropping canonical evidence",async()=>{
  const detail="Provider-returned descriptive commentary that repeats source context while the normalized field value and provenance remain separately available. ".repeat(6);
  const evidence={
   auditType:"full_a_and_r",artist:"Fixture Artist",title:"Production-sized narrative fixture",releaseDate:"2026-10-18",
   sourceProviders:["musicbrainz","spotify","apple_music","youtube"],
   fieldProvenance:Object.fromEntries(Array.from({length:48},(_,i)=>["field"+i,{
    source:["musicbrainz","spotify","apple_music"][i%3],status:"recognized",confidence:0.82,
    value:"normalized identity value "+i,detail,rawPayload:detail
   }])),
   identity:{artist:"Fixture Artist",title:"Production-sized narrative fixture",isrc:"USAAA2600001",matchStatus:"reconciled"},
   reconciliation:{status:"partial",matchedFields:["artist","title","isrc"],conflicts:Array.from({length:40},(_,i)=>"Conflict "+i+": "+detail)},
   genreClassification:{primaryGenre:"Contemporary R&B",genres:["Contemporary R&B"],abstained:false},
   catalogSources:["musicbrainz","spotify","apple_music"].map((platform)=>({platform,status:"matched",canonicalUrl:"https://example.invalid/"+platform})),
   commercialEvidence:{verified:false,reason:detail},commercialPerformance:{status:"unavailable",reason:detail},
   commercialMetrics:{streams:null,sales:null,reason:detail},audienceTelemetry:{status:"unavailable",reason:detail},
   catalogPopularity:{status:"unavailable",reason:detail},rightsStatus:{status:"unverified",notes:detail},
   deliveryStatus:{status:"unverified",notes:detail},releaseStatus:{status:"released",releaseDate:"2026-10-18"},masterApproved:false
  };
  const descriptors=Object.fromEntries(["rmsDbfs","peakDbfs","crestFactorDb","spectralCentroidHz","spectralBandwidthHz","spectralRolloff85Hz","spectralFlatness","spectralFlux","zeroCrossingRate","lowBandEnergyRatio","midBandEnergyRatio","highBandEnergyRatio"].map((name)=>[name,{
   median:0.42,p10:0.21,p90:0.78,unit:"ratio",method:"windowed_fft_measurement"
  }]));
  const sonicDna={
   provenance:"uploaded_audio_master",evidenceClass:"OBSERVED",analysisVersion:"sonic-dna-v1",
   sourceProviders:["essentia"],confidence:0.82,warnings:[detail],limitations:[detail],
   bpm:95,tempoConfidence:0.82,key:"A",mode:"minor",moodTags:["reflective","warm"],genreTags:["Contemporary R&B"],
   acousticFeatureProfile:{
    schemaVersion:"1.0.0",status:"measured",
    provenance:{featureVersion:"acoustic-profile-v1",sourceAudioSha256:"a".repeat(64),algorithm:"reson8-windowed-radix2-fft",
     sourceSampleRateHz:48000,analysisSampleRateHz:24000,analysisResampling:"block_average_antialias",channels:2,
     downmix:"arithmetic_mean",durationSeconds:210,sourceStartSeconds:0,sourceEndSeconds:210,
     windowSizeSamples:2048,hopSizeSamples:1024,windowCount:128,aggregation:"median_and_percentiles",maxWindowsApplied:true},
    descriptors,
    windowSummaries:Array.from({length:128},(_,i)=>({startSeconds:i*1.5,endSeconds:(i+1)*1.5,rmsDbfs:-18+i/10,spectralCentroidHz:1800+i,spectralFlatness:0.2})),
    predictions:{mood:{status:"provisional",labels:["warm","reflective"],scores:{bright:40,dark:60,driving:30,calm:70,tense:20,warm:80},method:"audio_feature_heuristics_v1",probability:null},
     energy:{status:"provisional",label:"moderate",score:54,method:"audio_feature_heuristics_v1",probability:null}},
    abstentionReasons:[detail]
   },
   vocalFeatures:{status:"analyzed",method:"open_unmix_umxhq_vocal_stem",
    model:{name:"Open-Unmix UMX-HQ vocals",artifactSha256:"f".repeat(64)},
    voicePresence:"likely_present",vocalStemRmsDbfs:-18.4,vocalEnergyShare:0.12,vocalActivityRatio:0.35,activeDurationSeconds:42,
    activitySegments:Array.from({length:128},(_,i)=>({startSeconds:i*1.5,endSeconds:(i+1)*1.5,meanLevelDbfs:-19.2,peakLevelDbfs:-12.4,description:detail})),
    pitchSegments:Array.from({length:128},(_,i)=>({startSeconds:i*1.5,endSeconds:(i+1)*1.5,medianHz:220+i,confidence:0.82,method:"pitch_tracking"})),
    limitations:[detail]}
  };
  const catalogMetadata=Object.fromEntries(Array.from({length:32},(_,i)=>["provider"+i,{status:"matched",source:"catalog provider "+i,detail,rawPayload:detail}]));
  const {mock}=fetchMock();
  let narrative:{payload:Record<string,any>;system:string;estimated:number;completion:number}|null=null;
  mock.mockImplementation(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const payload=JSON.parse(body.messages[1].content);
   if(payload.sectionGroup==="narrative"){
    const estimated=Math.ceil(new TextEncoder().encode(JSON.stringify({messages:body.messages,response_format:body.response_format})).length/2)+256;
    narrative={payload,system:body.messages[0].content,estimated,completion:body.max_completion_tokens};
   }
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p(payload.sectionGroup))}}]}),{status:200});
  });
  await new GroqClient("test-key","test-model",mock as typeof fetch,async()=>{}).assess({evidence,sonicDna,catalogMetadata});
  expect(narrative).not.toBeNull();
  expect(narrative!.estimated).toBeLessThanOrEqual(5744);
  expect(narrative!.estimated+narrative!.completion).toBeLessThanOrEqual(6000);
  expect(narrative!.completion).toBeGreaterThanOrEqual(256);
  expect(narrative!.payload.evidence.identity).toMatchObject({artist:"Fixture Artist",isrc:"USAAA2600001"});
  expect(narrative!.payload.evidence.fieldProvenance.field0).toMatchObject({source:"musicbrainz",value:"normalized identity value 0"});
  expect(narrative!.payload.sonicDna.acousticFeatureProfile.descriptors.spectralCentroidHz).toMatchObject({median:0.42,unit:"ratio"});
  expect(narrative!.payload.sonicDna.vocalFeatures).toMatchObject({status:"analyzed",voicePresence:"likely_present"});
  expect(narrative!.payload.catalogMetadata).toBeNull();
  for(const invariant of ["CONFIRMED","voting/window-consensus-stabilized","DETERMINED","PRE_RELEASE versus POST_RELEASE","PROPOSED","DSP/catalog links are not audio","No external stem, separation or render workers","OBSERVED","RECONCILED","industry_practice"]){
   expect(narrative!.system).toContain(invariant);
  }
 });
});


describe("evidence-score prompt budget compaction", () => {
  it("keeps the three previously failing large-context profiles below the 5,000-token engineering target", async () => {
    const profiles = [
      { name: "prior-5991", provenance: 14, conflicts: 12, segments: 24 },
      { name: "prior-6152", provenance: 32, conflicts: 28, segments: 48 },
      { name: "prior-6255", provenance: 48, conflicts: 40, segments: 60 },
    ];
    const observed: Array<{ name: string; estimated: number; completion: number; schemaBytes: number }> = [];
    for (const profile of profiles) {
      const detail = "Verbose provider commentary repeated for this fixture; source and normalized value remain independently retained. ".repeat(8);
      const evidence = {
        auditType: "full_a_and_r", artist: "Fixture Artist", title: profile.name,
        releaseDate: "2026-10-18", sourceProviders: ["musicbrainz", "spotify", "apple_music", "youtube"],
        fieldProvenance: Object.fromEntries(Array.from({ length: profile.provenance }, (_, i) => ["field" + i, {
          source: ["musicbrainz", "spotify", "apple_music"][i % 3], status: "recognized",
          confidence: 0.82, value: "normalized identity value " + i, detail, rawPayload: detail,
        }])),
        identity: { artist: "Fixture Artist", title: profile.name, isrc: "USAAA2600001", matchStatus: "reconciled" },
        reconciliation: { status: "partial", matchedFields: ["artist", "title", "isrc"],
          conflicts: Array.from({ length: profile.conflicts }, (_, i) => "Conflict " + i + ": " + detail) },
        genreClassification: { primaryGenre: "Contemporary R&B", genres: ["Contemporary R&B"], abstained: false },
        commercialEvidence: { verified: false, reason: detail },
        releaseStatus: { status: "released", releaseDate: "2026-10-18" },
      };
      const sonicDna = {
        provenance: "uploaded_audio_master", evidenceClass: "OBSERVED", analysisVersion: "sonic-dna-v1",
        sourceProviders: ["essentia"], confidence: 0.82, warnings: [detail], limitations: [detail],
        bpm: 95, tempoConfidence: 0.82, key: "A", mode: "minor",
        tonalResolution: { status: "CONFIRMED", tonic: "A", mode: "minor", confidence: 0.88, voteConsensus: 0.82 },
        rhythmFeatures: { status: "measured", candidateScores: [{ bpm: 95, score: 0.8 }], windowConsensus: 0.82 },
        harmonicFeatures: { status: "measured", topCandidates: [{ key: "A", mode: "minor" }], windowConsensus: 0.82 },
        vocalArrangementAnalysis: { status: "analyzed", segments: Array.from({ length: profile.segments }, (_, i) => ({
          startSeconds: i * 3, endSeconds: (i + 1) * 3, role: i % 2 ? "lead" : "backing", description: detail,
        })) },
      };
      const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const payload = JSON.parse(body.messages[1].content);
        const estimated = Math.ceil(new TextEncoder().encode(JSON.stringify({
          messages: body.messages, response_format: body.response_format,
        })).length / 3) + 256;
        if (payload.sectionGroup === "evidence-score") {
          observed.push({ name: profile.name, estimated, completion: body.max_completion_tokens,
            schemaBytes: new TextEncoder().encode(JSON.stringify(body.response_format.json_schema.schema)).length });
        }
        const recovered = p(payload.sectionGroup);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recovered) } }] }), { status: 200 });
      });
      await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence, sonicDna });
    }
    expect(observed).toHaveLength(3);
    console.info("EVIDENCE_SCORE_BUDGET_FIXTURES", JSON.stringify(observed));
    for (const item of observed) {
      expect(item.estimated, item.name).toBeLessThanOrEqual(5000);
      expect(item.completion, item.name).toBeGreaterThanOrEqual(256);
      expect(item.estimated + item.completion, item.name).toBeLessThanOrEqual(6000);
      expect(item.schemaBytes, item.name).toBeLessThan(2200);
    }
  });

  it("retains the evidence-score verdict and provenance invariants in its compact system instructions", async () => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "evidence-score") {
        const system = body.messages[0].content;
        for (const invariant of ["CONFIRMED", "voting/window-consensus-stabilized", "DETERMINED",
          "PRE_RELEASE/POST_RELEASE", "PROPOSED", "DSP/catalog links are not audio",
          "No external stem, separation or render workers", "OBSERVED", "RECONCILED", "industry_practice"]) {
          expect(system).toContain(invariant);
        }
        const schema = body.response_format.json_schema.schema;
        expect(schema.required).toEqual(expect.arrayContaining(["evidenceGaps", "confidence", "limitations", "scorecard", "humanListeningChecklist", "evidenceLabels"]));
        expect(schema.properties.scorecard.properties.rhythmicConsistency).toBeDefined();
        expect(schema.properties.evidenceLabels.items.properties.source).toBeDefined();
      }
      const recovered = p(payload.sectionGroup);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recovered) } }] }), { status: 200 });
    });
    await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null });
    expect(mock).toHaveBeenCalledTimes(9);
  });
});

describe("GroqClient cancellation", () => {
  it("aborts an in-flight provider request when the audit signal is aborted", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      if (!requestSignal) return new Response("missing abort signal", { status: 400 });
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason ?? new Error("aborted")), { once: true });
      });
    });
    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch, async () => {});
    const pending = (client.assess({ evidence: {}, sonicDna: null }, controller.signal) as Promise<unknown>);
    await Promise.resolve();
    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    await expect(pending).rejects.toThrow("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(controller.signal);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Groq request deadlines", () => {
  it("aborts a stalled provider request at the configured per-request deadline", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      if (!requestSignal) throw new Error("missing request signal");
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true });
      });
    });
    const client = new GroqClient("test-key", "test-model", fetchMock as typeof fetch, async () => {}, 5);
    await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow(
      "Groq narrative request timed out after 5ms",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe("Groq release-section JSON schema recovery", () => {
  it("falls back to JSON-object mode after repeated release schema rejection and still validates locally", async () => {
    let releaseCalls = 0;
    const releaseFormats: string[] = [];
    const releasePayloads: Array<Record<string, any>> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      const group = payload.sectionGroup;
      if (group === "release") {
        releaseCalls++;
        releaseFormats.push(body.response_format.type);
        releasePayloads.push(payload);
        if (releaseCalls <= 2) {
          return new Response(JSON.stringify({ error: {
            message: "Failed to validate JSON. Please adjust your prompt.",
            type: "invalid_request_error",
            code: "json_validate_failed",
            failed_generation: ""
          }}), { status: 400 });
        }
        if (releaseCalls === 3) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(group)) } }] }), { status: 200 });
    });
    const client = new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {});
    const result = await client.assess({ evidence: { artist: "Regression Artist" }, sonicDna: null });
    expect(releaseCalls).toBe(4);
    expect(releaseFormats).toEqual(["json_schema", "json_object", "json_object", "json_object"]);
    expect(releasePayloads[0].outputSchema).toBeUndefined();
    expect(releasePayloads[2].outputSchema).toBeDefined();
    expect(releasePayloads[2].outputSchema).toMatchObject({
      type: "object",
      properties: { releaseStrategy: { type: "object" } }
    });
    expect(releasePayloads[3].outputSchema).toEqual(releasePayloads[2].outputSchema);
    expect(releasePayloads[3].correction).toContain("releaseStrategy");
    expect(releasePayloads[3].correction).toContain("outputSchema");
    expect(result.releaseStrategy.priorities).toHaveLength(3);
  });
});

describe("Groq JSON-object fallback schema contract", () => {
  it("supplies the exact local Zod output schema to the model after strict-mode rejection", async () => {
    let evidenceScoreCalls = 0;
    const fallbackPayloads: Array<Record<string, any>> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userPayload = JSON.parse(body.messages[1].content);
      const group = userPayload.sectionGroup;
      if (group === "evidence-score") {
        evidenceScoreCalls++;
        if (body.response_format.type === "json_object") fallbackPayloads.push(userPayload);
        if (evidenceScoreCalls <= 2) {
          return new Response(JSON.stringify({ error: {
            message: "Failed to validate JSON. Please adjust your prompt.",
            code: "json_validate_failed",
            failed_generation: ""
          }}), { status: 400 });
        }
        if (evidenceScoreCalls === 3) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(group)) } }] }), { status: 200 });
    });
    const client = new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {});
    await client.assess({ evidence: {}, sonicDna: null });
    expect(fallbackPayloads).toHaveLength(3);
    expect(fallbackPayloads[0].outputSchema).toBeDefined();
    expect(fallbackPayloads[2].outputSchema).toEqual(fallbackPayloads[0].outputSchema);
    expect(fallbackPayloads[2].correction).toContain("evidenceGaps");
    const schema = fallbackPayloads[0].outputSchema;
    expect(schema).toMatchObject({ type: "object" });
    expect(schema.properties).toMatchObject({
      evidenceGaps: { type: "array" },
      confidence: { type: "number" },
      limitations: { type: "array" },
      scorecard: { type: "object" },
      humanListeningChecklist: { type: "array" },
      evidenceLabels: { type: "array" }
    });
    for (const dimension of ["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"]) {
      const dimensionSchema = schema.properties.scorecard.properties[dimension];
      expect(dimensionSchema.properties.score).toBeDefined();
      expect(dimensionSchema.properties.rationale).toMatchObject({ type: "string" });
    }
  });
});

describe("assessment provider billing availability", () => {
 it("marks a provider returning HTTP 402 unavailable for subsequent audit jobs", async () => {
  clearAssessmentProviderUnavailable();
  const mock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Payment required" } }), { status: 402 }));
  const client = new OllamaClient("test-ollama-key", "test-model", mock as typeof fetch, async () => {});
  await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow("HTTP 402");
  expect(getAssessmentProviderReadiness({ OLLAMA_API_KEY: "test-ollama-key" })).toMatchObject([
   { provider: "groq", usable: false, reason: "not_configured" },
   { provider: "gemini", usable: false, reason: "not_configured" },
   { provider: "ollama", usable: false, reason: "billing_required" },
  ]);
  clearAssessmentProviderUnavailable();
 });
});


describe("safe assessment validation diagnostics", () => {
 it("records the failing section and Zod issue paths without persisting generated response text", async () => {
  const attempts: Array<Record<string, unknown>> = [];
  const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
   const body = JSON.parse(String(init?.body));
   const group = JSON.parse(body.messages[1].content).sectionGroup;
   const value = p(group);
   if (group === "evidence-score") {
    delete (value as Record<string, unknown>).evidenceLabels;
   }
   return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
  });
  const client = new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {});
  await expect(client.assess({
   evidence: { privatePrompt: "must not be logged" }, sonicDna: null,
   recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); },
  })).rejects.toThrow("failed validation after bounded recovery");
  const failed = attempts.find(attempt => attempt.failureKind === "schema_violation");
  expect(failed).toMatchObject({ provider: "gemini", group: "evidence-score", failureKind: "schema_violation" });
  expect(failed?.validationIssues).toEqual(expect.arrayContaining([
   expect.objectContaining({ path: ["evidenceLabels"] }),
  ]));
  expect(JSON.stringify(attempts)).not.toContain("must not be logged");
  expect(JSON.stringify(attempts)).not.toContain("Regression Artist");
 });

 it("records section word-count failures as threshold violations without response content", async () => {
  const attempts: Array<Record<string, unknown>> = [];
  const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
   const body = JSON.parse(String(init?.body));
   const group = JSON.parse(body.messages[1].content).sectionGroup;
   const value = p(group);
   if (group === "evidence-score") (value as Record<string, unknown>).evidenceGaps = ["Missing audience data"];
   return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
  });
  const client = new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {});
  await expect(client.assess({
   evidence: {}, sonicDna: null,
   recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); },
  })).rejects.toThrow("evidence-score response failed validation after bounded recovery");
  expect(attempts.some(attempt => attempt.group === "evidence-score" && attempt.failureKind === "threshold_violation")).toBe(true);
 });
});

describe("Groq narrative token projection regression", () => {
  it("keeps a production-shaped verbose evidence payload under the unchanged 6,000-token ceiling", async () => {
    const logs: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((message?: unknown) => { if (typeof message === "string") logs.push(message); });
    try {
      const fieldProvenance = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        "field" + index,
        {
          source: "MusicBrainz catalogue source " + index,
          provider: "musicbrainz",
          status: "verified",
          confidence: 0.82,
          evidenceClass: "RECONCILED",
          value: "Verified source value with descriptive provenance details ".repeat(5),
          normalizedValue: "Normalized source value with matching evidence details ".repeat(5),
          matchStatus: "matched",
        },
      ]));
      const evidence = {
        auditType: "MASTER-BASED AUDIT", artist: "Fixture Artist", title: "Fixture Track",
        album: "Fixture Album", releaseDate: "2025-08-27", label: "Fixture Label",
        isrc: "NGABC2600001", upc: "123456789012", genres: ["Afrobeats", "Alternative R&B"],
        sourceProviders: ["musicbrainz", "audd", "spotify"], fieldProvenance,
        identity: { artist: "Fixture Artist", title: "Fixture Track", album: "Fixture Album", releaseDate: "2025-08-27" },
        reconciliation: { status: "reconciled", matchedFields: Array.from({ length: 20 }, (_, i) => "field-" + i), conflicts: [] },
        genreClassification: { primaryGenre: "Afrobeats", confidence: 0.82, source: "provider-reconciled" },
        catalogSources: Array.from({ length: 12 }, (_, i) => ({ platform: "catalog-" + i, provider: "provider-" + i, status: "available", description: "Catalog metadata detail ".repeat(8) })),
        commercialEvidence: { verified: false, reason: "No source-attributed commercial telemetry was supplied." },
        fixture: true,
      };
      const sonicDna = {
        provenance: "uploaded_audio_master", evidenceClass: "OBSERVED", analysisVersion: "fixture-v1",
        sourceProviders: ["essentia", "librosa"], confidence: 0.82, bpm: 95, tempoConfidence: 0.82,
        key: "A", mode: "minor", moodTags: ["Moderate Energy", "Bright Timbre"],
        warnings: Array.from({ length: 24 }, (_, i) => "Analysis warning " + i + ": " + "supporting detail ".repeat(8)),
        limitations: ["No commercial demand inference."],
        acousticFeatureProfile: {
          status: "measured", provenance: { featureVersion: "v1", algorithm: "fixture", sourceSampleRateHz: 44100, analysisSampleRateHz: 22050, windowCount: 128 },
          descriptors: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["descriptor" + i, { median: i, p10: i - 1, p90: i + 1, unit: "normalized" }])),
          predictions: { mood: { status: "heuristic", method: "fixture", probability: 0.4 }, energy: { status: "heuristic", method: "fixture", probability: 0.5 } },
          abstentionReasons: ["Insufficient context ".repeat(8)],
        },
        vocalFeatures: { status: "analyzed", summary: "Vocal signal summary ".repeat(30), intervals: Array.from({ length: 128 }, (_, i) => ({ startSeconds: i, endSeconds: i + 1, confidence: 0.7, role: "unknown" })) },
      };
      const { mock } = fetchMock();
      await new GroqClient("test-groq-key", "test-model", mock as typeof fetch, async () => {})
        .assess({
          evidence, sonicDna,
          loadCompletedSectionGroup: async group => group === "narrative" ? null : p(group),
        });
      const narrativeBudget = logs.map(line => JSON.parse(line) as Record<string, unknown>)
        .find(line => line.event === "request_budget" && line.group === "narrative");
      expect(narrativeBudget).toMatchObject({ maxTotalTokens: 6000 });
      expect(Number(narrativeBudget?.estimatedTotalTokens)).toBeLessThanOrEqual(6000);
      expect(Number(narrativeBudget?.maxCompletionTokens)).toBeGreaterThanOrEqual(256);
    } finally {
      info.mockRestore();
    }
  });
});

describe("nine-section report-readiness integration", () => {
  it("runs every assessment section and adapts the complete report-ready data contract", async () => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      const recovered = p(payload.sectionGroup);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recovered) } }] }), { status: 200 });
    });
    const assessment = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Fixture Artist", title: "Fixture Track", fixture: true }, sonicDna: null });
    const groups = new Set(mock.mock.calls.map(call => {
      const body = JSON.parse(String(call[1]?.body));
      return JSON.parse(body.messages[1].content).sectionGroup;
    }));
    expect(groups).toEqual(new Set(["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"]));
    expect(Object.values(assessment.generationProvenance.fieldGroups)).toEqual(expect.arrayContaining([
      "narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline",
    ]));
    expect(assessment.aAndRPositioning.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(assessment.commercialRead.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    const reportData = adaptReportV2({
      auditId: "nine-section-readiness-fixture",
      generatedAt: "2026-11-24T00:00:00.000Z",
      evidence: { artist: "Fixture Artist", title: "Fixture Track", fixture: true },
      sonicDna: null,
      assessment,
      executionMode: "dsp_link",
    });
    expect(reportData.decisionDimensions).toHaveLength(4);
    expect(reportData.hasVerifiedCommercialEvidence).toBe(false);
    expect(reportData.tempo.value).toBeNull();
    expect(reportData.key.value).toBeNull();
  });

  it("retains both positioning minima after zero-confidence evidence sanitization", async () => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      const value = p(payload.sectionGroup) as Record<string, any>;
      if (payload.sectionGroup === "evidence-score") value.confidence = 0;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
    });
    const assessment = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null });
    expect(assessment.confidence).toBe(0);
    expect(assessment.aAndRPositioning.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(assessment.commercialRead.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
  });
});

describe("positioning contract and provider recovery regressions", () => {
  it.each(["aAndRPositioning.rationale", "commercialRead.rationale"])(
    "reports the exact %s word-count threshold and recovers with a corrected response",
    async (field) => {
      const attempts: Array<Record<string, unknown>> = [];
      let positioningCalls = 0;
      let positioningInstructions = "";
      const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const payload = JSON.parse(body.messages[1].content);
        if (payload.sectionGroup === "positioning") {
          positioningInstructions = body.messages[0].content;
          positioningCalls++;
          if (positioningCalls === 1) {
            const invalid = p("positioning") as any;
            const short = "The supplied evidence supports this limited positioning hypothesis while important source limitations remain and require verification before any external decision is made.";
            invalid[field === "aAndRPositioning.rationale" ? "aAndRPositioning" : "commercialRead"].rationale = short;
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] }), { status: 200 });
          }
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
      });
      const result = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
      expect(positioningCalls).toBe(2);
      expect(positioningInstructions).toContain("aAndRPositioning.rationale");
      expect(positioningInstructions).toContain("commercialRead.rationale");
      expect(positioningInstructions).toContain("at least 40 words");
      expect(result.aAndRPositioning.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
      expect(result.commercialRead.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
      const failed = attempts.find(attempt => attempt.group === "positioning" && attempt.failureKind === "threshold_violation");
      expect(failed).toMatchObject({
        validationField: field,
        validationRule: "minimum_word_count",
        minimumWords: 40,
      });
      expect(failed?.actualWords).toBe(22);
      expect(JSON.stringify(attempts)).not.toContain("supplied evidence supports this limited positioning hypothesis");
    },
  );

  it.each(["narrative", "positioning"])(
    "recovers the %s section after transient Gemini HTTP 503 responses",
    async (targetGroup) => {
      let calls = 0;
      const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const payload = JSON.parse(body.messages[1].content);
        if (payload.sectionGroup === targetGroup && calls++ < 2) {
          return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), { status: 503 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
      });
      const attempts: Array<Record<string, unknown>> = [];
      const result = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
      expect(result.assessmentVersion).toBe("3.0");
      expect(result.generationProvenance.fieldGroups).toHaveProperty("executionPlan", "timeline");
      expect(new Set(mock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).messages[1].content)
        .map(content => JSON.parse(content).sectionGroup))).toHaveProperty("size", 9);
      expect(calls).toBe(3);
      expect(attempts.filter(attempt => attempt.group === targetGroup && attempt.status === 503)).toHaveLength(2);
      expect(mock.mock.calls.filter(call => JSON.parse(String(call[1]?.body)).messages[1].content.includes('"sectionGroup":"' + targetGroup + '"'))).toHaveLength(3);
    },
  );
});



describe("repeated structured-output validation recovery", () => {
  it.each([
    { group: "positioning", field: "commercialRead.rationale", minimum: 40, short: "Commercial rationale remains limited by the absence of verified performance evidence and requires further independent validation before marketability can be assessed." },
    { group: "evidence-score", field: "scorecard.tempoLaneFit.rationale", minimum: 25, short: "Tempo evidence is unavailable and no score can be supported from the supplied material." },
  ])("switches output mode and recovers repeated $field violations", async ({ group, field, minimum, short }) => {
    let groupCalls = 0;
    const attempts: Array<Record<string, unknown>> = [];
    let recoveredPayload: Record<string, any> | null = null;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === group && groupCalls++ < 2) {
        const invalid = p(group) as any;
        if (field === "commercialRead.rationale") invalid.commercialRead.rationale = short;
        else invalid.scorecard.tempoLaneFit.rationale = short;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] }), { status: 200 });
      }
      const recovered = p(payload.sectionGroup);
      if (payload.sectionGroup === group && groupCalls >= 2) recoveredPayload = recovered as Record<string, any>;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recovered) } }] }), { status: 200 });
    });
    const assessment = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
    expect(groupCalls).toBe(3);
    const diagnostics = attempts.filter(attempt => attempt.group === group && attempt.failureKind === "threshold_violation");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({ validationField: field, validationRule: "minimum_word_count", minimumWords: minimum });
    expect(Number(diagnostics[0].actualWords)).toBeLessThan(minimum);
    expect(diagnostics[1]).toMatchObject({ validationField: field, validationRule: "minimum_word_count", minimumWords: minimum });
    const recoveredRationale = field === "commercialRead.rationale"
      ? recoveredPayload?.commercialRead?.rationale
      : recoveredPayload?.scorecard?.tempoLaneFit?.rationale;
    expect(String(recoveredRationale).split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(minimum);
    const groupRequests = mock.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
      .filter(body => JSON.parse(body.messages[1].content).sectionGroup === group);
    expect(groupRequests[2].response_format).toEqual({ type: "json_object" });
  });
});


describe("complete local A&R provider contract", () => {
  it.each([
    ["narrative", "executiveSummary>=45 words", "strengths>=3 items, each>=10 words"],
    ["positioning", "aAndRPositioning.rationale>=40 words", "commercialRead.rationale>=40 words"],
    ["release", "releaseStrategy.recommendation>=40 words", "releaseStrategy.priorities>=3 items, each>=8 words"],
    ["evidence-score", "scorecard.tempoLaneFit.rationale>=25 words", "scorecard.tonalConsensus.rationale>=25 words if present"],
    ["production", "productionArrangementGuidance>=40 words", "listeningChecks>=4 items, each>=5 words"],
    ["comparables", "laneHypothesis>=20 words", "referencesToVerify>=3 items, each>=8 words"],
    ["promotion", "promotionPlan.preRelease>=20 words", "promotionPlan.playlistCategories>=3 items, each>=3 words"],
    ["label-fit", "labelPartnerFit.partnerProfile>=25 words", "labelPartnerFit.criteriaToDemonstrate>=4 items, each>=5 words"],
    ["timeline", "executionPlan.days30>=20 words", "executionPlan.days90>=20 words"],
  ])("states every locally enforced threshold for the %s section", async (group, firstRule, secondRule) => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null });
    const request = mock.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
      .find(body => JSON.parse(body.messages[1].content).sectionGroup === group);
    expect(request).toBeDefined();
    expect(request.messages[0].content).toContain("Mandatory word minima (all enforced locally)");
    expect(request.messages[0].content).toContain(firstRule);
    expect(request.messages[0].content).toContain(secondRule);
    expect(request.messages[0].content).toContain("Compacted local schema bounds (all mandatory)");
  });

  it("retries rejected network fetches with bounded backoff instead of immediately abandoning the section", async () => {
    let narrativeCalls = 0;
    const sleeps: number[] = [];
    const attempts: Array<Record<string, unknown>> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative" && narrativeCalls++ < 2) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async ms => { sleeps.push(ms); })
      .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
    expect(result.assessmentVersion).toBe("3.0");
    expect(narrativeCalls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every(ms => ms >= 800 && ms <= 2400)).toBe(true);
    expect(attempts.filter(attempt => attempt.group === "narrative" && attempt.status === null)).toHaveLength(2);
  });

  it("recovers when a provider returns an HTTP-success response with a malformed JSON envelope", async () => {
    let narrativeCalls = 0;
    const attempts: Array<Record<string, unknown>> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative") {
        const attempt = narrativeCalls++;
        if (attempt === 0) return new Response("not-json", { status: 200 });
        if (attempt === 1) return new Response("null", { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
    expect(result.assessmentVersion).toBe("3.0");
    expect(narrativeCalls).toBe(3);
    expect(attempts.filter(attempt => attempt.group === "narrative" && attempt.failureKind === "invalid_json")).toHaveLength(2);
  });

  it("applies the same 25-word scorecard rationale contract to optional tonalConsensus when present", async () => {
    let evidenceCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      let value = p(payload.sectionGroup) as Record<string, any>;
      if (payload.sectionGroup === "evidence-score") {
        evidenceCalls++;
        value = { ...value, scorecard: { ...value.scorecard, tonalConsensus: {
          score: null,
          rationale: evidenceCalls === 1 ? "The tonal consensus remains provisional because the available evidence does not establish a stable result for this recording." : long("Tonal consensus remains unscored because the supplied key and mode evidence does not meet the voting and window agreement requirements for a confirmed result.", 30),
        } } };
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
    });
    const attempts: Array<Record<string, unknown>> = [];
    await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: {}, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt as unknown as Record<string, unknown>); } });
    expect(evidenceCalls).toBe(2);
    expect(attempts).toContainEqual(expect.objectContaining({
      group: "evidence-score", failureKind: "threshold_violation",
      validationField: "scorecard.tonalConsensus.rationale", validationRule: "minimum_word_count", minimumWords: 25,
    }));
  });
});


describe("Groq narrative prompt budget recovery", () => {
  it("compacts an HTTP 400 correction prompt under the 6,000-token ceiling without losing canonical evidence", async () => {
    const provenance = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ["field" + index, {
      source: "musicbrainz_catalog_provider_" + index,
      provider: "musicbrainz",
      status: "recognized",
      confidence: 0.91,
      evidenceClass: "RECOGNIZED",
      value: ("source-attributed identity value " + index + " with supporting catalog detail ").repeat(3),
      normalizedValue: ("normalized identity value " + index + " with reconciled catalog detail ").repeat(3),
    }]));
    const evidence = {
      auditType: "MASTER-BASED AUDIT", sourceType: "master", artist: "Budget Fixture",
      title: "Budget Recovery Track", isrc: "NGABC2600001",
      sourceProviders: ["musicbrainz", "audD", "lastfm"],
      fieldProvenance: provenance,
      identity: { artist: "Budget Fixture", title: "Budget Recovery Track", isrc: "NGABC2600001" },
      reconciliation: { status: "RECONCILED", conflicts: [], matchedFields: ["artist", "title", "isrc"] },
      catalogSources: Array.from({ length: 12 }, (_, index) => ({ platform: "provider-" + index, status: "matched", provider: "provider-" + index, source: "catalog" })),
    };
    const sonicDna = {
      provenance: "uploaded_audio_master", evidenceClass: "OBSERVED", bpm: 112, tempoConfidence: 0.86,
      key: "A", mode: "minor", genreTags: ["Alternative R&B"],
      acousticFeatureProfile: {
        status: "measured",
        provenance: { featureVersion: "1.0", algorithm: "fixture", sourceSampleRateHz: 44100, analysisSampleRateHz: 22050, windowCount: 128 },
        descriptors: { spectralCentroid: { median: 1200, p10: 900, p90: 1800, unit: "Hz" } },
        predictions: Object.fromEntries(Array.from({ length: 16 }, (_, index) => ["prediction" + index, {
          label: "optional interpretation " + index,
          detail: ("non-mandatory model interpretation context " + index + " ").repeat(8),
          probability: 0.4,
          method: "optional-model-prediction",
        }])),
      },
      vocalFeatures: {
        status: "analyzed", provenance: "uploaded_audio_master", confidence: 0.8, method: "fixture",
        activitySegments: Array.from({ length: 30 }, (_, index) => ({
          startSeconds: index * 2, endSeconds: index * 2 + 1, meanLevelDbfs: -18, peakLevelDbfs: -4,
          commentary: ("optional vocal timeline commentary " + index + " ").repeat(8),
        })),
        pitchSegments: Array.from({ length: 30 }, (_, index) => ({
          startSeconds: index * 2, endSeconds: index * 2 + 1, medianHz: 220, confidence: 0.8,
          method: "optional pitch timeline",
        })),
      },
    };
    const requests: Array<{ body: any; estimatedInputTokens: number }> = [];
    let narrativeCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      const estimatedInputTokens = Math.ceil(new TextEncoder().encode(JSON.stringify({
        messages: body.messages, response_format: body.response_format,
      })).length / 3) + 256;
      requests.push({ body, estimatedInputTokens });
      if (payload.sectionGroup === "narrative" && narrativeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "json_validate_failed", message: "Structured output validation failed" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({
        evidence, sonicDna,
        loadCompletedSectionGroup: async group => group === "narrative" ? null : p(group),
      });

    const narrativeRequests = requests.filter(request =>
      JSON.parse(request.body.messages[1].content).sectionGroup === "narrative");
    expect(narrativeRequests).toHaveLength(2);
    expect(narrativeRequests[0].estimatedInputTokens).toBeLessThanOrEqual(6000 - 500 - 850);
    expect(narrativeRequests[1].estimatedInputTokens + narrativeRequests[1].body.max_completion_tokens).toBeLessThanOrEqual(6000);
    expect(narrativeRequests[1].body.max_completion_tokens).toBeGreaterThanOrEqual(256);
    const correctedPayload = JSON.parse(narrativeRequests[1].body.messages[1].content);
    expect(correctedPayload.evidence).toMatchObject({
      artist: "Budget Fixture", title: "Budget Recovery Track", isrc: "NGABC2600001",
      sourceProviders: ["musicbrainz", "audD", "lastfm"],
    });
    expect(correctedPayload.evidence.fieldProvenance).toHaveProperty("field0");
    expect(correctedPayload.evidence.identity).toBeDefined();
    expect(result.assessmentVersion).toBe("3.0");
  });
});

describe("nine-section master and DSP-link execution modes", () => {
  it.each([
    {
      mode: "master",
      sonicDna: { provenance: "uploaded_audio_master", evidenceClass: "OBSERVED", bpm: 112, tempoConfidence: 0.86, key: "A", mode: "minor", tonalResolution: { status: "CONFIRMED", tonic: "A", mode: "minor", confidence: 0.9, voteConsensus: 0.84 } },
      evidence: { auditType: "MASTER-BASED AUDIT", sourceType: "master", artist: "Master Fixture", title: "Master Fixture Track" },
    },
    {
      mode: "dsp_link",
      sonicDna: null,
      evidence: { auditType: "DSP-LINK AUDIT", sourceType: "dsp_link", artist: "DSP Fixture", title: "DSP Fixture Track", catalogUrl: "https://music.example/track/123" },
    },
  ])("completes all nine assessment groups and report adaptation for $mode input", async ({ mode, sonicDna, evidence }) => {
    let narrativeAttempts = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative" && narrativeAttempts++ === 0) {
        return new Response(JSON.stringify({ error: { code: "json_validate_failed", message: "Structured output rejected" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    const assessment = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence, sonicDna });
    const groups = mock.mock.calls.map(call => {
      const body = JSON.parse(String(call[1]?.body));
      return JSON.parse(body.messages[1].content).sectionGroup;
    });
    expect(new Set(groups)).toEqual(new Set(["narrative", "positioning", "release", "evidence-score", "production", "comparables", "promotion", "label-fit", "timeline"]));
    expect(groups).toHaveLength(10);
    expect(groups.filter(group => group === "narrative")).toHaveLength(2);
    expect(assessment.aAndRPositioning.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(assessment.commercialRead.rationale.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    if (mode === "dsp_link") {
      expect(assessment.scorecard.rhythmicConsistency.score).toBeNull();
      expect(assessment.scorecard.tempoLaneFit.score).toBeNull();
    }
    const report = adaptReportV2({
      auditId: "nine-section-" + mode,
      generatedAt: "2026-11-25T00:00:00.000Z",
      evidence,
      sonicDna,
      assessment,
      executionMode: mode,
    });
    expect(report.decisionDimensions).toHaveLength(4);
    if (mode === "dsp_link") {
      expect(report.tempo.value).toBeNull();
      expect(report.key.value).toBeNull();
      expect(report.hasVerifiedCommercialEvidence).toBe(false);
    }
  });

  it("keys completed section caching and persistence by the actual provider and model", async () => {
    const loaded: Array<{ group: string; provider: string; model: string }> = [];
    const saved: Array<{ group: string; provider: string; model: string }> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    await new GroqClient("test-key", "cache-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: {}, sonicDna: null,
        loadCompletedSectionGroup: async (group, provider, model) => { loaded.push({ group, provider, model }); return null; },
        saveCompletedSectionGroup: async (group, _result, provider, model) => { saved.push({ group, provider, model }); },
      });
    expect(loaded).toHaveLength(9);
    expect(saved).toHaveLength(9);
    expect(loaded.every(item => item.provider === "groq" && item.model === "cache-model")).toBe(true);
    expect(saved.every(item => item.provider === "groq" && item.model === "cache-model")).toBe(true);
  });
});


describe("Groq rolling TPM retry accounting", () => {
  it("reserves the full estimated request cost again for every network retry", async () => {
    const acquire = vi.spyOn(sharedGroqTokenLimiter, "acquire").mockResolvedValue();
    vi.stubEnv("NODE_ENV", "production");
    let narrativeCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative" && narrativeCalls++ < 2) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    try {
      await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence: {}, sonicDna: null });
      expect(narrativeCalls).toBe(3);
      expect(acquire).toHaveBeenCalledTimes(11);
    } finally {
      vi.unstubAllEnvs();
      acquire.mockRestore();
    }
  });
});


describe("Gemini section cache provenance", () => {
  it("loads and saves fallback sections under Gemini identity rather than Groq identity", async () => {
    const loaded: Array<{ group: string; provider: string; model: string }> = [];
    const saved: Array<{ group: string; provider: string; model: string }> = [];
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    await new GeminiClient("test-gemini-key", "gemini-cache-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: {}, sonicDna: null,
        loadCompletedSectionGroup: async (group, provider, model) => { loaded.push({ group, provider, model }); return null; },
        saveCompletedSectionGroup: async (group, _result, provider, model) => { saved.push({ group, provider, model }); },
      });
    expect(loaded).toHaveLength(9);
    expect(saved).toHaveLength(9);
    expect(loaded.every(item => item.provider === "gemini" && item.model === "gemini-cache-model")).toBe(true);
    expect(saved.every(item => item.provider === "gemini" && item.model === "gemini-cache-model")).toBe(true);
  });
});


describe("assessment section cache resilience", () => {
  it("does not fail a valid nine-section assessment when cache persistence is temporarily unavailable", async () => {
    let loadCalls = 0;
    let saveCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    const assessment = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: {}, sonicDna: null,
        loadCompletedSectionGroup: async () => { loadCalls++; throw new Error("temporary cache read failure"); },
        saveCompletedSectionGroup: async () => { saveCalls++; throw new Error("temporary cache write failure"); },
      });
    expect(assessment.assessmentVersion).toBe("3.0");
    expect(loadCalls).toBe(9);
    expect(saveCalls).toBe(9);
  });
});


describe("assessment section cache lease fencing", () => {
  it("does not swallow a lost worker lease while persisting a completed section", async () => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
    });
    await expect(new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({
        evidence: {}, sonicDna: null,
        saveCompletedSectionGroup: async () => { throw new Error("AUDIT_LEASE_LOST"); },
      })).rejects.toThrow("AUDIT_LEASE_LOST");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});


describe("Groq narrative completion recovery", () => {
  it.each(["length", null])("raises the bounded completion allowance when finish_reason is %s", async finishReason => {
    const narrativeBudgets: number[] = [];
    const attempts: ProviderAttemptDiagnostic[] = [];
    let narrativeAttempts = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative") {
        narrativeBudgets.push(body.max_completion_tokens);
        narrativeAttempts++;
        if (narrativeAttempts === 1) {
          return new Response(JSON.stringify({
            choices: [{ finish_reason: finishReason, message: { content: '{"assessmentVersion":"3.0","executiveSummary":' } }],
            usage: { prompt_tokens: 2500, completion_tokens: 850, total_tokens: 3350 },
          }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(p(payload.sectionGroup)) } }],
        usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000 },
      }), { status: 200 });
    });

    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Completion Fixture" }, sonicDna: null, recordProviderAttempt: async attempt => { attempts.push(attempt); } });

    expect(result.assessmentVersion).toBe("3.0");
    expect(narrativeBudgets).toHaveLength(2);
    expect(narrativeBudgets[0]).toBe(850);
    expect(narrativeBudgets[1]).toBeGreaterThan(narrativeBudgets[0]);
    expect(narrativeBudgets[1]).toBeLessThanOrEqual(2000);
    expect(attempts).toContainEqual(expect.objectContaining({ failureKind: "completion_truncated", failureClass: "completion_truncated", finishReason, completionTokenBudget: 850, actualUsage: { status: "reported", promptTokens: 2500, completionTokens: 850, totalTokens: 3350 } }));
    expect(mock.mock.calls.every(call => {
      const body = JSON.parse(String(call[1]?.body));
      const estimate = Math.ceil(new TextEncoder().encode(JSON.stringify({
        messages: body.messages, response_format: body.response_format,
      })).length / 3) + 256;
      return estimate + body.max_completion_tokens <= 6000;
    })).toBe(true);
  });
});


describe("production A&R provider capacity regressions", () => {
  it("continues adaptive Groq narrative recovery beyond 1,600 tokens without crossing the 6,000-token ceiling", async () => {
    const budgets: number[] = [];
    let narrativeCalls = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative") {
        budgets.push(body.max_completion_tokens);
        narrativeCalls++;
        if (narrativeCalls <= 3) {
          const completion = budgets[budgets.length - 1];
          return new Response(JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: '{"assessmentVersion":"3.0","executiveSummary":' } }],
            usage: { prompt_tokens: 2500, completion_tokens: completion, total_tokens: 2500 + completion },
          }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(p(payload.sectionGroup)) } }],
        usage: { prompt_tokens: 2500, completion_tokens: 500, total_tokens: 3000 },
      }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Long Narrative Fixture" }, sonicDna: null });
    expect(result.assessmentVersion).toBe("3.0");
    expect(budgets).toHaveLength(4);
    expect(budgets[0]).toBe(850);
    expect(budgets[1]).toBe(1275);
    expect(budgets[2]).toBe(1913);
    expect(budgets[3]).toBe(2000);
    expect(mock.mock.calls.every(call => {
      const body = JSON.parse(String(call[1]?.body));
      const estimate = Math.ceil(new TextEncoder().encode(JSON.stringify({
        messages: body.messages, response_format: body.response_format,
      })).length / 3) + 256;
      return estimate + body.max_completion_tokens <= 6000;
    })).toBe(true);
  });


});


describe("Groq retry prompt-usage calibration", () => {
  it("uses reported prompt usage to restore completion headroom on a truncated narrative retry", async () => {
    const provenance = Object.fromEntries(Array.from({ length: 60 }, (_, index) => ["field" + index, {
      source: "musicbrainz_catalog_provider_" + index,
      provider: "musicbrainz",
      status: "recognized",
      confidence: 0.91,
      evidenceClass: "RECOGNIZED",
      value: ("source-attributed identity value " + index + " with supporting catalog detail ").repeat(3),
      normalizedValue: ("normalized identity value " + index + " with reconciled catalog detail ").repeat(3),
    }]));
    const evidence = {
      auditType: "MASTER-BASED AUDIT", sourceType: "master", artist: "Usage Calibration Fixture",
      title: "Long Evidence Track", isrc: "NGABC2600001",
      sourceProviders: ["musicbrainz", "audD", "lastfm"],
      fieldProvenance: provenance,
      identity: { artist: "Usage Calibration Fixture", title: "Long Evidence Track", isrc: "NGABC2600001" },
      reconciliation: { status: "RECONCILED", conflicts: [], matchedFields: ["artist", "title", "isrc"] },
    };
    const narrativeBudgets: number[] = [];
    let narrativeAttempts = 0;
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      if (payload.sectionGroup === "narrative") {
        narrativeBudgets.push(body.max_completion_tokens);
        narrativeAttempts++;
        if (narrativeAttempts === 1) {
          return new Response(JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: '{"assessmentVersion":"3.0","executiveSummary":' } }],
            usage: { prompt_tokens: 2517, completion_tokens: body.max_completion_tokens, total_tokens: 2517 + body.max_completion_tokens },
          }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(p(payload.sectionGroup)) } }],
        usage: { prompt_tokens: 2517, completion_tokens: 500, total_tokens: 3017 },
      }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence, sonicDna: null });
    expect(result.assessmentVersion).toBe("3.0");
    expect(narrativeBudgets.length).toBeGreaterThanOrEqual(2);
    expect(narrativeBudgets[0]).toBe(850);
    expect(narrativeBudgets[1]).toBeGreaterThanOrEqual(1275);
    expect(narrativeBudgets[1]).toBeLessThanOrEqual(2000);
  });
});


describe("provider completion finish-reason precedence", () => {
  it("does not treat a complete stop response as truncated merely because usage reaches its token allowance", async () => {
    const attempts: ProviderAttemptDiagnostic[] = [];
    const calls = new Map<string, number>();
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      calls.set(payload.sectionGroup, (calls.get(payload.sectionGroup) ?? 0) + 1);
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(p(payload.sectionGroup)) } }],
        usage: { prompt_tokens: 2500, completion_tokens: body.max_completion_tokens, total_tokens: 2500 + body.max_completion_tokens },
      }), { status: 200 });
    });
    const result = await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
      .assess({ evidence: { artist: "Stop Finish Fixture" }, sonicDna: null,
        recordProviderAttempt: async attempt => { attempts.push(attempt); } });
    expect(result.assessmentVersion).toBe("3.0");
    expect(calls.get("narrative")).toBe(1);
    expect(attempts.some(attempt => attempt.failureKind === "completion_truncated")).toBe(false);
  });
});


describe("shared Groq and Gemini request token budget", () => {
  it("enforces the 6,000-token total ceiling and 256-token completion floor on every Gemini section", async () => {
    const budgetLogs: Array<Record<string, unknown>> = [];
    const info = vi.spyOn(console, "info").mockImplementation((message?: unknown) => {
      if (typeof message !== "string") return;
      try {
        const event = JSON.parse(message) as Record<string, unknown>;
        if (event.event === "request_budget") budgetLogs.push(event);
      } catch { /* Ignore unrelated console output. */ }
    });
    const { mock } = fetchMock();
    try {
      const evidence = {
        artist: "Budget Fixture",
        sourceProviders: ["musicbrainz", "audd", "lastfm"],
        identity: { artist: "Budget Fixture", title: "Budget Track" },
        reconciliation: { status: "RECONCILED", conflicts: [], matchedFields: ["artist", "title"] },
        fieldProvenance: Object.fromEntries(Array.from({ length: 80 }, (_, index) => ["field" + index, {
          source: "musicbrainz", provider: "musicbrainz", status: "recognized", confidence: 0.9,
          evidenceClass: "RECOGNIZED", value: ("verified source fact " + index + " ").repeat(12),
          normalizedValue: ("normalized source fact " + index + " ").repeat(12),
        }])),
      };
      const result = await new GeminiClient("test-gemini-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence, sonicDna: null });
      expect(result.assessmentVersion).toBe("3.0");
      expect(budgetLogs).toHaveLength(9);
      for (const budget of budgetLogs) {
        expect(budget.maxTotalTokens).toBe(6000);
        expect(Number(budget.estimatedTotalTokens)).toBeLessThanOrEqual(6000);
        expect(Number(budget.maxCompletionTokens)).toBeGreaterThanOrEqual(256);
      }
    } finally {
      info.mockRestore();
    }
  });
});
