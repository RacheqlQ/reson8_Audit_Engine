import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, GeminiClient, GroqClient, OllamaClient, GROQ_PROMPT_VERSION, GROQ_ASSESSMENT_TIMEOUT_MS, GEMINI_ASSESSMENT_TIMEOUT_MS, OLLAMA_ASSESSMENT_TIMEOUT_MS } from "../src/providers/groq/client.js";
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
 it("keeps all provider deadlines within the ten-minute assessment stage",()=>{
  expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBe(4*60_000);
  expect(GEMINI_ASSESSMENT_TIMEOUT_MS).toBe(3*60_000);
  expect(OLLAMA_ASSESSMENT_TIMEOUT_MS).toBe(2*60_000);
  expect(GROQ_ASSESSMENT_TIMEOUT_MS+GEMINI_ASSESSMENT_TIMEOUT_MS+OLLAMA_ASSESSMENT_TIMEOUT_MS).toBeLessThan(10*60_000);
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
   expect(body.max_completion_tokens).toBeLessThanOrEqual(1200);
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
  for(const call of mock.mock.calls){const body=JSON.parse(String(call[1]?.body));expect(body.model).toBe(DEFAULT_GROQ_MODEL);expect(body.response_format.type).toBe("json_schema");expect(body.messages[0].content).toContain("Never invent streams");expect(body.messages[1].content).toContain(GROQ_PROMPT_VERSION);}
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
  const result=await client.assess({evidence:{},sonicDna:{provenance:"uploaded_audio_master",bpm:120,tempoConfidence:0.8}});
  expect(evidenceScoreCalls).toBe(2);
  expect(prompts[0]).toContain("scorecard.rhythmicConsistency.rationale");
  expect(prompts[0]).toContain("at least 25 words");
  expect(prompts[1]).toContain("scorecard.rhythmicConsistency.rationale must contain at least 25 words");
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
  expect(sleeps).toContain(60_000);
 });

 it("stops after the corrective retry when evidenceGaps remains below eight words",async()=>{
  let evidenceScoreCalls=0;
  const prompts:string[]=[];
  const mock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),group=body.response_format.json_schema.name.replace(/^ar_/,"");
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
   .rejects.toThrow("Groq evidence-score response failed Zod validation after one retry");
  expect(evidenceScoreCalls).toBe(2);
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
        })).length / 2) + 256;
        if (payload.sectionGroup === "evidence-score") {
          observed.push({ name: profile.name, estimated, completion: body.max_completion_tokens,
            schemaBytes: new TextEncoder().encode(JSON.stringify(body.response_format.json_schema.schema)).length });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
      });
      await new GroqClient("test-key", "test-model", mock as typeof fetch, async () => {})
        .assess({ evidence, sonicDna });
    }
    expect(observed).toHaveLength(3);
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
          "No external stem/separation/render workers", "OBSERVED", "RECONCILED", "industry_practice"]) {
          expect(system).toContain(invariant);
        }
        const schema = body.response_format.json_schema.schema;
        expect(schema.required).toEqual(expect.arrayContaining(["evidenceGaps", "confidence", "limitations", "scorecard", "humanListeningChecklist", "evidenceLabels"]));
        expect(schema.properties.scorecard.properties.rhythmicConsistency).toBeDefined();
        expect(schema.properties.evidenceLabels.items.properties.source).toBeDefined();
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(p(payload.sectionGroup)) } }] }), { status: 200 });
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  })).rejects.toThrow("failed Zod validation");
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
  })).rejects.toThrow("evidence-score response failed Zod validation");
  expect(attempts.some(attempt => attempt.group === "evidence-score" && attempt.failureKind === "threshold_violation")).toBe(true);
 });
});
