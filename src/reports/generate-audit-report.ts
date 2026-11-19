import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { ArAssessment } from "../providers/groq/client.js";
import { loadReportFonts } from "./fonts.js";
import { isReliableKey, isReliableTempo, hasMultipleTuningWindows, sanitizeAssessmentForEvidence } from "./evidence-guardrails.js";
import { buildStrengthRiskChartRows, chartPanelHeight, chartPanelLayoutErrors, countEvidenceLayers, drawChartPanel, type ChartPanelInput } from "./charts.js";
import { hasSubmittedMasterAudio } from "../audio/master-audio-evidence.js";
import type { RealMasterAuditContract } from "../audio/real-master-contract.js";

export type AuditReportTier = "sample" | "full";
export interface AuditReportInput { auditId:string; generatedAt:string; evidence:Record<string,unknown>; sonicDna:Record<string,unknown>|null; assessment:ArAssessment; executionMode?:"master"|"combined"|"dsp_link"; realMasterContract?:RealMasterAuditContract; }
export interface ReportRect { x:number;y:number;width:number;height:number;id:string; }
export interface ReportPagePlan { title:string;text:string[]; }
const W=595.28,H=841.89,M=48,TOP=735,BOTTOM=76,AVAILABLE=TOP-BOTTOM;
const C={navy:rgb(11/255,27/255,58/255),blue:rgb(47/255,107/255,1),violet:rgb(124/255,77/255,1),teal:rgb(31/255,209/255,178/255),coral:rgb(1,107/255,94/255),paper:rgb(247/255,245/255,240/255),ink:rgb(22/255,29/255,43/255),muted:rgb(91/255,101/255,119/255),line:rgb(220/255,222/255,226/255),white:rgb(1,1,1)};
export function normalizeReportText(value: string): string {
 return value.normalize("NFKC")
  .replace(/[\u2018\u2019\u201A\u201B]/g,"'")
  .replace(/[\u201C\u201D\u201E\u201F]/g,'"')
  .replace(/[\u2010-\u2015\u2212]/g,"-")
  .replace(/[\u00A0\u202F]/g," ")
  .replace(/[\u2026]/g,"...")
  .replace(/[\u2022\u25CF]/g,"-")
  .replace(/[\u00D7]/g,"x")
  .replace(/[\u266F]/g,"#")
  .replace(/[\u266D]/g,"b")
  .replace(/[\u2190-\u21FF]/g," ")
  .replace(/[\u2260]/g,"!=")
  .replace(/[\u2264]/g,"<=")
  .replace(/[\u2265]/g,">=")
  .replace(/[\u00A9]/g,"(c)")
  .replace(/[\u00AE]/g,"(R)")
  .replace(/[\u2122]/g,"TM")
  .replace(/[\uFFFD]/g,"")
  .replace(/[^\x20-\x7E\u00A0-\u00FF]/g,"");
}
const text=(v:unknown):string=>v===null||v===undefined||v===""?"":Array.isArray(v)?v.map(text).filter(Boolean).join(", "):typeof v==="object"?"":typeof v==="number"&&Number.isFinite(v)?String(Number(v.toFixed(2))):normalizeReportText(String(v));
const isHttpsUrl=(value:unknown):boolean=>{
 if(typeof value!=="string")return false;
 try{const parsed=new URL(value);return parsed.protocol==="https:"&&Boolean(parsed.hostname);}
 catch{return false;}
};
const isValidVerificationDate=(value:unknown):boolean=>
 typeof value==="string"
 && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
 && Number.isFinite(Date.parse(value));
const val=(v:unknown,fallback="Not supplied")=>text(v)||fallback;
const metric=(v:unknown,decimals:number,fallback="Not supplied")=>typeof v==="number"&&Number.isFinite(v)?v.toFixed(decimals):val(v,fallback);
const EXTERNAL_ID_LABELS:Record<string,string>={spotify:"Spotify",apple_music:"Apple Music",tidal:"TIDAL",deezer:"Deezer",youtube_music:"YouTube Music",audiomack:"Audiomack",audd:"AudD",musicbrainz:"MusicBrainz"};
function externalIdentifierValue(value:unknown):string[]{
 const scalar=(candidate:unknown):string|null=>{
  if(typeof candidate==="string"&&candidate.trim())return normalizeReportText(candidate.trim());
  if(typeof candidate==="number"&&Number.isFinite(candidate))return String(candidate);
  return null;
 };
 const direct=scalar(value);
 if(direct)return [direct];
 if(Array.isArray(value))return value.map(scalar).filter((entry):entry is string=>Boolean(entry));
 if(value&&typeof value==="object"){
  const record=value as Record<string,unknown>;
  for(const key of ["id","value","uri","url"]){
   const candidate=scalar(record[key]);
   if(candidate)return [candidate];
  }
 }
 return [];
}
function externalIdentifiers(value:unknown):string{
 if(!value||typeof value!=="object"||Array.isArray(value))return "";
 return Object.entries(value as Record<string,unknown>).flatMap(([provider,raw])=>{
  const identifiers=externalIdentifierValue(raw);
  if(!identifiers.length)return [];
  const label=EXTERNAL_ID_LABELS[provider]??provider.replace(/[_-]+/g," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());
  return [label+": "+identifiers.join(", ")];
 }).join("; ");
}
const chartValue=(v:unknown):string|number|null=>typeof v==="string"||typeof v==="number"&&Number.isFinite(v)?v:null;
function wrap(value:string,font:PDFFont,size:number,width:number):string[]{
 value=normalizeReportText(value);
 const out:string[]=[];let line="";
 for(const word of value.split(/\s+/).filter(Boolean)){
  if(font.widthOfTextAtSize(word,size)>width){
   if(line){out.push(line);line="";}
   let part="";for(const char of word){if(font.widthOfTextAtSize(part+char,size)>width&&part){out.push(part);part=char;}else part+=char;}
   line=part;continue;
  }
  const candidate=line?line+" "+word:word;
  if(font.widthOfTextAtSize(candidate,size)>width&&line){out.push(line);line=word;}else line=candidate;
 }
 if(line)out.push(line);return out;
}
export function checkLayout(rects:ReportRect[]):{ok:boolean;errors:string[]}{
 const errors:string[]=[];
 for(let i=0;i<rects.length;i++){const a=rects[i];if(a.x<0||a.y<0||a.x+a.width>W+.01||a.y+a.height>H+.01)errors.push("Out-of-page element: "+a.id);
  for(let j=i+1;j<rects.length;j++){const b=rects[j];if(a.x<b.x+b.width-.5&&a.x+a.width>b.x+.5&&a.y<b.y+b.height-.5&&a.y+a.height>b.y+.5)errors.push("Intersecting elements: "+a.id+" / "+b.id);}}
 return {ok:errors.length===0,errors};
}
export function checkPageDensity(rects:ReportRect[]):{ok:boolean;emptyRatio:number}{
 if(rects.length===0)return {ok:false,emptyRatio:1};
 const top=Math.max(...rects.map(r=>r.y+r.height)),bottom=Math.min(...rects.map(r=>r.y));
 const occupied=Math.max(0,Math.min(AVAILABLE,top-bottom));
 const ratio=Math.max(0,Math.min(1,1-occupied/AVAILABLE));
 return {ok:ratio<=.4,emptyRatio:ratio};
}
function header(page:PDFPage,title:string,n:number,f:{regular:PDFFont;bold:PDFFont},accent=C.blue,fixture=false){page.drawRectangle({x:0,y:H-7,width:W,height:7,color:accent});page.drawText("RESON8 / A&R INTELLIGENCE",{x:M,y:H-34,size:8,font:f.bold,color:C.navy});if(fixture)page.drawText("SYNTHETIC FIXTURE",{x:W-M-105,y:H-34,size:6.5,font:f.bold,color:C.coral});page.drawText(title.toUpperCase(),{x:M,y:H-58,size:7,font:f.bold,color:accent});page.drawLine({start:{x:M,y:H-68},end:{x:W-M,y:H-68},color:C.line,thickness:.7});page.drawLine({start:{x:M,y:43},end:{x:W-M,y:43},color:C.line,thickness:.7});page.drawText("CONFIDENTIAL • EVIDENCE-LED ASSESSMENT",{x:M,y:28,size:6.5,font:f.regular,color:C.muted});page.drawText(String(n).padStart(2,"0"),{x:W-M-18,y:27,size:8,font:f.bold,color:C.navy});}
function cover(pdf:PDFDocument,input:AuditReportInput,f:{regular:PDFFont;bold:PDFFont}){
 const p=pdf.addPage([W,H]);p.drawRectangle({x:0,y:0,width:W,height:H,color:C.paper});p.drawRectangle({x:0,y:H-14,width:W,height:14,color:C.navy});
 const coverRects:ReportRect[]=[];
 const add=(id:string,x:number,y:number,width:number,height:number)=>coverRects.push({x,y,width,height,id});
 p.drawText("RESON8",{x:M,y:H-82,size:17,font:f.bold,color:C.navy});add("cover-logo",M,H-85,90,20);
 p.drawText("A&R INTELLIGENCE",{x:M,y:H-103,size:8,font:f.bold,color:C.blue});add("cover-subtitle",M,H-106,140,10);
 p.drawText("TRACK AUDIT",{x:M,y:H-210,size:11,font:f.bold,color:C.violet});add("cover-kicker",M,H-213,100,13);
 p.drawText("Artist & release",{x:M,y:H-260,size:31,font:f.bold,color:C.navy});add("cover-title-line-1",M,H-264,230,34);
 p.drawText("decision brief",{x:M,y:H-299,size:31,font:f.bold,color:C.navy});add("cover-title-line-2",M,H-303,230,34);
 const artistLines=wrap(val(input.evidence.artist,"Artist not supplied"),f.bold,15,W-2*M);
 let artistY=H-360;for(let n=0;n<artistLines.length;n++){p.drawText(artistLines[n],{x:M,y:artistY,size:15,font:f.bold,color:C.ink});add("cover-artist-"+n,M,artistY-3,W-2*M,18);artistY-=18;}
 const titleLines=wrap(val(input.evidence.title,"Track not supplied"),f.regular,12,W-2*M);
 let titleY=artistY-6;for(let n=0;n<titleLines.length;n++){p.drawText(titleLines[n],{x:M,y:titleY,size:12,font:f.regular,color:C.muted});add("cover-track-"+n,M,titleY-3,W-2*M,15);titleY-=15;}
 if(titleY<365)console.warn("[report-layout] Cover identity text exceeds its preferred area.");
 p.drawRectangle({x:M,y:250,width:W-2*M,height:104,color:C.navy});
 p.drawText("ASSESSMENT VERDICT",{x:M+18,y:326,size:7,font:f.bold,color:C.teal});add("cover-verdict-label",M+18,323,130,9);
 p.drawText(coverVerdictLabel(input).toUpperCase(),{x:M+18,y:292,size:15,font:f.bold,color:C.white});add("cover-verdict",M+18,289,180,22);
 p.drawText("EVIDENCE STATUS",{x:W-M-116,y:326,size:7,font:f.bold,color:C.teal});add("cover-evidence-status-label",W-M-116,323,105,9);
 p.drawText("Not a calibrated probability",{x:W-M-116,y:292,size:7,font:f.bold,color:C.white});add("cover-evidence-status-value",W-M-116,289,105,12);
 const dateLines=wrap("Generated "+input.generatedAt.slice(0,10)+" • Version "+input.assessment.assessmentVersion,f.regular,8,W-2*M);
 let dateY=210;for(let n=0;n<dateLines.length;n++){p.drawText(dateLines[n],{x:M,y:dateY,size:8,font:f.regular,color:C.muted});add("cover-date-version-"+n,M,dateY-2,W-2*M,11);dateY-=12;}
 const auditLines=wrap("Audit "+input.auditId,f.regular,7,W-2*M);
 let auditY=dateY-3;for(let n=0;n<auditLines.length;n++){p.drawText(auditLines[n],{x:M,y:auditY,size:7,font:f.regular,color:C.muted});add("cover-audit-id-"+n,M,auditY-2,W-2*M,10);auditY-=11;}
 if(input.evidence.fixture===true){p.drawText("FIXTURE — NOT A REAL ANALYSIS",{x:M,y:70,size:8,font:f.bold,color:C.coral});add("cover-fixture-label",M,67,230,10);}
 p.drawText("PRIVATE & CONFIDENTIAL",{x:M,y:54,size:7,font:f.bold,color:C.navy});add("cover-confidentiality",M,51,200,9);
 const coverCheck=checkLayout(coverRects);if(!coverCheck.ok)console.warn("[report-layout] Cover layout warnings:",coverCheck.errors);
}
interface Section{title:string;accent:"blue"|"violet"|"teal"|"coral";body:string[];}
function verdictLabel(v:string):string{const m:Record<string,string>={high:"Ready to pitch",moderate:"Develop",low:"Needs work",undetermined:"Insufficient evidence"};return m[v.toLowerCase()]??"Insufficient evidence";}
export interface ArNotesDecisionContext { heading:string; verdict:string; summary:string; prompts:string[]; }
export function paginateArNotesSummary(lines:string[]):string[][] {
 const chunks:string[][]=[];let offset=0;
 while(lines.length-offset>16){
  const count=Math.min(42,lines.length-offset-16);
  chunks.push(lines.slice(offset,offset+count));
  offset+=count;
 }
 chunks.push(lines.slice(offset));
 return chunks;
}
export function buildArNotesDecisionContext(input:AuditReportInput):ArNotesDecisionContext {
 const safeAssessment=sanitizeAssessmentForEvidence(input.assessment,input.sonicDna,input.evidence);
 const openItems=[...(Array.isArray(safeAssessment.evidenceGaps)?safeAssessment.evidenceGaps:[]),...(Array.isArray(safeAssessment.risks)?safeAssessment.risks:[])]
  .filter((item):item is string=>typeof item==="string"&&item.trim().length>0)
  .filter((item,index,items)=>items.indexOf(item)===index)
  .slice(0,1)
  .map((item)=>item.length>105?item.slice(0,102)+"...":item);
 const fullSummary=val(safeAssessment.executiveSummary,"Further listening and source verification are required.");
 const safeSummary=fullSummary.length>180?fullSummary.slice(0,177)+"...":fullSummary;
 const nextAction="Verify identity, rights and the submitted master before pitching.";
 return {
  heading:"DECISION CONTEXT",
  verdict:coverVerdictLabel(input).toUpperCase(),
  summary:[
   "Decision basis: "+safeSummary,
   "Open diligence: "+(openItems.join(" ")||"No additional diligence items were recorded."),
   "Next action: "+nextAction,
  ].join(" "),
  prompts:[
   "What evidence would change the current decision?",
   "Which identity, rights or source gaps remain unresolved?",
   "What should be verified before any external pitch?",
  ],
 };
}
export function coverVerdictLabel(input:AuditReportInput):string {
 const safeAssessment=sanitizeAssessmentForEvidence(input.assessment,input.sonicDna,input.evidence);
 return verdictLabel(val(safeAssessment.commercialRead?.marketability,"undetermined"));
}
function verdictRule(v:string):string{const m:Record<string,string>={high:"Ready to pitch requires verified commercial-performance evidence, a defined reporting period and a supportable release proposition.",moderate:"Develop applies when evidence supports a credible direction but important execution or positioning work remains.",low:"Needs work applies when supplied evidence identifies material gaps that should be addressed before pitching.",undetermined:"Insufficient evidence applies when source-attributed commercial or release evidence is missing; no demand or partner interest is inferred."};return m[v.toLowerCase()]??m.undetermined;}
function industryPractice(v:string):string{return "General industry guidance — "+v.replace(/^(?:INDUSTRY PRACTICE\s*[—:-]\s*)+/i,"").trim();}

function drawSpotifyMark(page:PDFPage,x:number,y:number,size:number):void {
 const green=rgb(30/255,215/255,96/255),black=rgb(0,0,0),scale=size/24;
 page.drawCircle({x:x+size/2,y:y+size/2,size:size/2,color:green});
 for(const path of [
  "M 3 7 C 8 4.8 16 5.4 21 8.5",
  "M 4 12 C 8.5 10 15 10.7 19.5 13.4",
  "M 5.5 17 C 9 15.6 13.5 16.2 17.5 18.3",
 ]) page.drawSvgPath(path,{x:x+size*0.08,y:y+size*0.08,scale,borderColor:black,borderWidth:Math.max(0.8,size/12)});
}

function professionalEvidenceLanguage(value:string):string {
 return value
  .replace(/Vocal analysis:\s*Not performed[^.]*\./gi,"")
  .replace(/vocal presence\/absence is unknown[^.]*\./gi,"")
  .replace(/(?:learned audio(?:-genre)?|audio-only genre|vocal|detection|classification) model(?: status)?[^.]*\b(?:disabled|not configured|unavailable)\b[^.]*\.?/gi,"")
  .replace(/(?:model|detector) status:\s*(?:disabled|not configured|unavailable)[^.]*\.?/gi,"")
  .replace(/\bmodel:\s*disabled\b[^.]*\.?/gi,"")
  .replace(/audio-only genre classification[^.]*\bdisabled\b[^.]*\.?/gi,"")
  .replace(/\b(?:insufficient_evidence|signal_diagnostics_only|not_analyzed)\b/gi,"")
  .replace(/autocorrelation_voiced_periodicity/gi,"")
  .replace(/(?:vocal analysis|learned audio model) (?:is|was) temporarily disabled[^.]*\./gi,"")
  .replace(/vocal analysis (?:was|is) not performed[^.]*\./gi,"")
  .replace(/key and mode confidence was below threshold[^.]*\.?/gi,"")
  .replace(/tempo candidate prominence is too weak[^.]*\.?/gi,"")
  .replace(/high_frequency_transient_autocorrelation|fft_harmonic_chroma_ensemble/gi,"")
  .replace(/periodic energy is not proof of human vocals[^.]*\.?/gi,"")
  .replace(/singing, speech, vocal presence\/absence and vocal arrangement remain undetermined[^.]*\.?/gi,"")
  .replace(/\bOBSERVED\b/g,"Measured from the uploaded master")
  .replace(/\bRECOGNIZED\b/g,"Returned by an external source")
  .replace(/\bRECONCILED\b/g,"Cross-checked across independent sources")
  .replace(/\bINFERRED\b/g,"Analytical hypothesis")
  .replace(/\bINDUSTRY PRACTICE\b/g,"General industry guidance");
}
export function metadataFieldStatus(e:Record<string,unknown>,field:string):string{
 const value=text(field==="genre"?(e.genre??e.genres):e[field]);
 if(!value)return "Unavailable — no source result";
 const sources=Array.isArray(e.sources)?e.sources:[];
 if(e.fixture===true||sources.includes("synthetic_audio_fixture"))return "Synthetic test value — not a real identity match";
 const reconciliation=e.reconciliation&&typeof e.reconciliation==="object"?e.reconciliation as Record<string,unknown>:{};
 const conflicts=Array.isArray(reconciliation.conflicts)?reconciliation.conflicts as Array<Record<string,unknown>>:[];
 if(conflicts.some((entry)=>entry.field===field))return "Conflicting source values";
 const reconciled=Array.isArray(reconciliation.reconciledFields)?reconciliation.reconciledFields:[];
 if(reconciled.includes(field))return "Cross-checked across independent sources";
 const providers=Array.isArray(e.sourceProviders)?e.sourceProviders:[];
 if(providers.length&&providers.every((provider)=>provider==="id3"))return "Read from embedded audio tags";
 if(providers.length||e.evidenceClass==="RECOGNIZED")return "Returned by an identification or catalog source";
 if(e.evidenceClass==="INFERRED")return "Analytical hypothesis — not verified";
 const checked=Array.isArray(e.metadataSourcesChecked)?e.metadataSourcesChecked:[];
 if(checked.includes("synthetic_audio_fixture"))return "Synthetic test value — not a real identity match";
 if((field==="artist"||field==="title")&&checked.includes("filename"))return "Parsed from uploaded filename — not independently verified";
 return "Available — source classification not confirmed";
}
export function metadataFieldSource(e:Record<string,unknown>,field:string):string{
 const provenance=e.fieldProvenance&&typeof e.fieldProvenance==="object"?e.fieldProvenance as Record<string,unknown>:{};
 const provider=provenance[field];
 const labels:Record<string,string>={spotify:"Spotify",musicbrainz:"MusicBrainz",tidal:"TIDAL",apple_music:"Apple Music",deezer:"Deezer",youtube_music:"YouTube Music",audiomack:"Audiomack",audd:"AudD recognition",id3:"Embedded audio tags",filename:"Uploaded filename"};
 return typeof provider==="string"&&labels[provider]? "Field source: "+labels[provider] : "Field source: unavailable";
}
export function sonicDashboardRowsForReport(s:Record<string,unknown>|null,hasAudio:boolean):Array<{label:string;value:string|null}> {
 const tempoReliable=hasAudio&&isReliableTempo(s);
 const keyReliable=hasAudio&&isReliableKey(s);
 const tempoCandidate=typeof s?.tempoCandidateBpm==="number"&&Number.isFinite(s.tempoCandidateBpm)?s.tempoCandidateBpm:null;
 const tempoConfidence=typeof s?.tempoConfidence==="number"&&Number.isFinite(s.tempoConfidence)?s.tempoConfidence:null;
 const rhythm=s?.rhythmFeatures&&typeof s.rhythmFeatures==="object"?s.rhythmFeatures as Record<string,unknown>:{};
 const tempoScores=Array.isArray(rhythm.candidateScores)?rhythm.candidateScores.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object")):[];
 const leadingTempoScore=tempoScores.find((item)=>item.bpm===tempoCandidate);
 const tempoReason=text(rhythm.abstentionReason);
 const beatTimes=Array.isArray(rhythm.beatTimesSeconds)?rhythm.beatTimesSeconds:[];
 const harmonic=s?.harmonicFeatures&&typeof s.harmonicFeatures==="object"?s.harmonicFeatures as Record<string,unknown>:{};
 const keyCandidates=Array.isArray(harmonic.topCandidates)?harmonic.topCandidates.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object")).slice(0,3).map((item)=>[text(item.key),text(item.mode),typeof item.score==="number"?"score "+item.score.toFixed(3):""].filter(Boolean).join(" ")).join("; "):"";
 return [
  {label:"TEMPO BPM",value:tempoReliable?metric(s?.bpm,1):null},
  {label:"TEMPO CANDIDATE BPM",value:hasAudio&&!tempoReliable&&tempoCandidate!==null?String(tempoCandidate)+" (provisional; prominence diagnostic "+(tempoConfidence===null?"not available":tempoConfidence.toFixed(2))+(leadingTempoScore&&typeof leadingTempoScore.score==="number"?"; candidate score "+leadingTempoScore.score.toFixed(3):"")+")":null},
  {label:"TEMPO DETECTION REASON",value:hasAudio&&!tempoReliable?(tempoReason||"No tempo candidate passed the reliability gate."):null},
  {label:"BEAT GRID STATUS",value:!hasAudio?null:beatTimes.length?String(rhythm.beatGridStatus||"provisional")+" (candidate; not independently validated)":"Not established"},
  {label:"BEAT TIMESTAMP COUNT",value:!hasAudio?null:beatTimes.length?String(beatTimes.length)+" generated timestamps; count is not a reliability measure":"No beat timestamps generated"},
  {label:"KEY / MODE",value:keyReliable?[text(s?.key),text(s?.mode)].filter(Boolean).join(" ")||null:null},
  {label:"KEY / MODE CANDIDATES",value:hasAudio&&!keyReliable&&keyCandidates?keyCandidates:null},
  {label:"KEY CONFIDENCE DIAGNOSTIC",value:hasAudio&&!keyReliable&&typeof s?.keyConfidence==="number"?(s.keyConfidence.toFixed(2)+" raw estimator score; not a calibrated probability; segment agreement "+(typeof s.keySegmentAgreement==="number"?s.keySegmentAgreement.toFixed(2):"not available")):null},
  {label:"KEY CANDIDATE REASON",value:hasAudio&&!keyReliable?text(harmonic.limitation)||"Key and mode did not pass the reliability gate.":null},
  {label:"TUNING OFFSET CANDIDATE CENTS",value:hasAudio&&hasMultipleTuningWindows(s)?metric(s?.keyTuningCents,0)+" (multiple tonal windows; provisional)":null},
  {label:"INTEGRATED LOUDNESS LUFS",value:hasAudio?metric(s?.loudnessLufs,1):null},
  {label:"LOUDNESS RANGE LRA",value:hasAudio?metric(s?.loudnessRangeLu,1):null},
  {label:"TRUE PEAK dBFS",value:hasAudio?metric(s?.truePeakDbfs,1):null},
  {label:"RMS LEVEL dBFS",value:hasAudio?metric(s?.rmsLevelDbfs,1):null},
  {label:"RMS ENVELOPE SPREAD dB",value:hasAudio?metric(s?.dynamicRangeDb,1):null},
  {label:"RMS ENERGY",value:hasAudio?metric(s?.rmsEnergy,2):null},
  {label:"SPECTRAL CENTROID HZ",value:hasAudio?metric(s?.spectralCentroidHz,0):null}
 ];
}

export function signalDashboardRowsForReport(s:Record<string,unknown>|null,hasAudio:boolean):Array<{label:string;value:string|null}> {
 const vocal=s?.vocalFeatures&&typeof s.vocalFeatures==="object"?s.vocalFeatures as Record<string,unknown>:{};
 return [
  {label:"SAMPLE RATE HZ",value:hasAudio?metric(s?.sampleRate,0):null},
  {label:"CHANNELS",value:hasAudio?metric(s?.channels,0):null},
  {label:"SPECTRAL CENTROID HZ",value:hasAudio?metric(s?.spectralCentroidHz,0):null},
  {label:"SPECTRAL BANDWIDTH HZ",value:hasAudio?metric(s?.spectralBandwidthHz,0):null},
  {label:"SPECTRAL ROLLOFF HZ",value:hasAudio?metric(s?.spectralRolloffHz,0):null},
  {label:"ZERO CROSSING RATE",value:hasAudio?metric(s?.zeroCrossingRate,4):null},
  {label:"SIGNAL PERIODICITY ACTIVITY RATIO",value:hasAudio?metric(vocal.periodicityActivityRatio,2):null}
 ];
}

function chartsForSection(i:AuditReportInput,title:string):ChartPanelInput[]{
 const a=sanitizeAssessmentForEvidence(i.assessment,i.sonicDna,i.evidence),e=i.evidence,s=i.sonicDna,hasAudio=Boolean(s&&s.provenance==="uploaded_audio_master"),tempoReliable=isReliableTempo(s),counts=countEvidenceLayers(a.evidenceLabels);

 if(title==="Evidence ledger and provenance")return [{title:"Evidence layers",kind:"layers",evidenceClass:"assessment-derived",rows:[{label:"Measured",value:counts.OBSERVED},{label:"Source matches",value:counts.RECOGNIZED},{label:"Cross-checked",value:counts.RECONCILED},{label:"Hypotheses",value:counts.INFERRED}],shows:"Counts of claims carrying each evidence label in this assessment.",cantShow:"Whether a claim is true, complete or commercially meaningful."}];
 if(title==="Identity and source reconciliation"&&Array.isArray(e.catalogSources)&&e.catalogSources.length>0){
  const sources=e.catalogSources.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"));
  const count=(status:string)=>sources.filter((item)=>item.status===status).length;
  return [{title:"DSP platform coverage",kind:"bars",evidenceClass:"provider-recognized",rows:[
   {label:"Recognized",value:count("recognized")},
   {label:"Partial",value:count("partial")},
   {label:"Unavailable",value:count("unavailable")},
  ],shows:"Provider lookup outcomes across the submitted track links.",cantShow:"Audience size, stream counts, playlist placement or listener demand."}];
 }
 if(title==="Sonic DNA and technical profile")return [
  {
   title:"Sonic DNA dashboard",kind:"sonic",evidenceClass:"measured",unavailable:!hasAudio,
   rows:sonicDashboardRowsForReport(s,hasAudio),
   shows:"Confidence-qualified tempo and key/mode plus direct loudness and RMS measurements from the uploaded master.",cantShow:"Audience demand, listener response, mastering quality or commercial performance."
  },
  {
   title:"Signal characteristics",kind:"sonic",evidenceClass:"measured",unavailable:!hasAudio,
   rows:signalDashboardRowsForReport(s,hasAudio),
   shows:"File format and signal-derived spectral/periodicity measurements with their original units.",cantShow:"Vocal presence, musical mood, genre or commercial performance."
  }
 ];
 if(title==="Creative identity and A&R positioning")return [{title:"Lane constellation",kind:"constellation",evidenceClass:"inferred",inferred:true,rows:[{label:"Primary lane",value:a.aAndRPositioning.primaryLane},...a.aAndRPositioning.adjacentLanes.slice(0,4).map(v=>({label:"Adjacent lane",value:v}))],shows:"The stated primary and adjacent lane hypotheses.",cantShow:"Measured genre distance, verified market size or audience overlap."}];
 if(title==="Evidence-derived scorecard")return [{title:"Evidence scorecard",kind:"radar",evidenceClass:"assessment-derived",rows:[{label:"Tempo / lane fit",value:a.scorecard.tempoLaneFit.score},{label:"Rhythmic consistency",value:a.scorecard.rhythmicConsistency.score},{label:"RMS / envelope",value:a.scorecard.dynamicRangeLoudness.score},{label:"Metadata",value:a.scorecard.metadataCompleteness.score},{label:"Release readiness",value:a.scorecard.releaseReadiness.score}],shows:"Evidence-derived numeric scores for dimensions with adequate source support.",cantShow:"Artistic taste, hook quality, originality or unmeasured release outcomes."}];
 if(title==="Strengths and creative leverage")return [{title:"Strengths versus risks",kind:"tension",evidenceClass:"assessment-derived",rows:buildStrengthRiskChartRows(a.strengths.slice(0,10),a.risks.slice(0,10)),shows:"Counts of documented strengths and risks in the assessment; counts are items, not weights.",cantShow:"Relative severity, weighting, probability of success or commercial outcomes."}];
 if(title==="Promotion plan")return [{title:"Discovery pathway",kind:"chain",evidenceClass:"illustrative",rows:[{label:"Content",value:"Approved short-form excerpt"},{label:"Discovery",value:"See provider-attributed playlist shortlist in A&R positioning"},{label:"Listener action",value:"Track saves and attributable visits"}],shows:"An illustrative sequence of approved content, discovery categories and measurable next-step signals.",cantShow:"Conversion, playlist placement or audience growth."}];
 if(title==="30 / 60 / 90-day execution plan")return [{title:"Execution timeline",kind:"timeline",evidenceClass:"illustrative",rows:[{label:"30 days",value:"Verify master, rights and identity"},{label:"60 days",value:"Prepare approved assets and delivery"},{label:"90 days",value:"Review evidence and decide next step"}],shows:"Concise milestones derived from the three staged execution-plan sections.",cantShow:"Calendar dates, delivery completion or guaranteed outcomes."}];
 return [];
}

function sections(i:AuditReportInput):Section[]{
 const a=sanitizeAssessmentForEvidence(i.assessment,i.sonicDna,i.evidence),e=i.evidence,s=i.sonicDna,hasAudio=Boolean(s&&s.provenance==="uploaded_audio_master"),hasMasterAudio=hasSubmittedMasterAudio(e,s),tempoReliable=isReliableTempo(s);
 const catalogSources=Array.isArray(e.catalogSources)?e.catalogSources.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object")):[];
 const sourceCombinationLabel=String(e.sourceCombination??"")==="master_and_dsp"?"Combined — uploaded master audio + submitted DSP catalog link.":String(e.sourceCombination??"")==="master_only"?"Master audio only.":String(e.sourceCombination??"")==="dsp_only"?"DSP catalog link only.":hasMasterAudio?"Master audio submitted; DSP source combination not recorded.":"DSP source combination not recorded.";
 const providerName=(value:unknown)=>(({apple_music:"Apple Music",spotify:"Spotify",tidal:"TIDAL",youtube_music:"YouTube Music",deezer:"Deezer",audiomack:"Audiomack",musicbrainz:"MusicBrainz"} as Record<string,string>)[String(value)]??text(value))||"DSP provider";
 const providerLookupSummary=catalogSources.length?catalogSources.map((item)=>providerName(item.platform)+" — "+text(item.status||"unknown")+" — "+text(item.reason||"No lookup reason was recorded.")+(text(item.canonicalUrl)?" — "+text(item.canonicalUrl):"")+(String(item.platform)==="musicbrainz"?" — EVALUATION ONLY: commercial-use permission is unverified; do not distribute this report commercially until permission is confirmed.":"")).join("; "):String(e.sourceCombination??"")==="master_and_dsp"?"No DSP provider lookup result was recorded; the submitted link requires retry or manual verification.":"No DSP provider lookup result was recorded.";
 const platformPresenceSummary=catalogSources.length?catalogSources.map((item)=>providerName(item.platform)+": "+text(item.status||"unknown")+(text(item.canonicalUrl)?" ("+text(item.canonicalUrl)+")":"")).join("; "):"Not supplied — no platform presence results were recorded.";
 const genreRecord=(s?.genreClassification??e.genreClassification)&&typeof (s?.genreClassification??e.genreClassification)==="object"?(s?.genreClassification??e.genreClassification) as Record<string,unknown>:{};
 const genreCandidates=Array.isArray(genreRecord.genres)?genreRecord.genres.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object")):[];
 const genreLabels=genreCandidates.map((item)=>text(item.label)).filter(Boolean);
 const genreSources=[...new Set(genreCandidates.flatMap((item)=>Array.isArray(item.sources)?item.sources.filter((value):value is string=>typeof value==="string"):[]))];
 const genreUnmappedDetails=Array.isArray(genreRecord.unmappedTags)?genreRecord.unmappedTags.flatMap((item)=>{
  if(!item||typeof item!=="object")return [];
  const record=item as Record<string,unknown>,provider=text(record.provider),tag=text(record.tag);
  return provider&&tag?[provider+" — "+tag]:[];
 }):[];
 const primaryGenre=text(genreRecord.primaryGenre)||"No primary genre asserted — insufficient or conflicting provider evidence";

 const verifiedCuratorTargets=Array.isArray(e.curatorTargets)?e.curatorTargets.filter((item):item is Record<string,unknown>=>{
  if(!item||typeof item!=="object"||Array.isArray(item))return false;
  const target=item as Record<string,unknown>;
  return target.status==="verified"
   && Boolean(text(target.name))
   && Boolean(text(target.platform))
   && isHttpsUrl(target.sourceUrl)
   && Boolean(text(target.fitRationale))
   && isHttpsUrl(target.submissionRoute)
   && Boolean(text(target.submissionRequirements))
   && isValidVerificationDate(target.verifiedAt);
 }):[];
 const playlistDiscovery= e.playlistDiscovery&&typeof e.playlistDiscovery==="object"&&!Array.isArray(e.playlistDiscovery)
  ? e.playlistDiscovery as Record<string,unknown> : {};
 const playlistCandidates=Array.isArray(playlistDiscovery.candidates)
  ? playlistDiscovery.candidates.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"&&!Array.isArray(item))) : [];
 const playlistOutcomes=Array.isArray(playlistDiscovery.outcomes)
  ? playlistDiscovery.outcomes.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"&&!Array.isArray(item))) : [];
 const playlistMoodTags=Array.isArray(playlistDiscovery.moodTagsUsed)?playlistDiscovery.moodTagsUsed.map(text).filter(Boolean):[];
 const playlistMoodSummary=playlistMoodTags.length
  ? "Mood search tags: "+playlistMoodTags.join(", ")+" [Source: "+(text(playlistDiscovery.moodSource)||"DSP catalogue metadata")+"]; these are provider-supplied catalogue descriptors, not an audio-derived mood measurement."
  : "Mood alignment was not asserted because no source-attributed DSP mood tags were available; playlist matching is limited to the confirmed genre and adjacent lanes.";
 const vocalFeatures=s?.vocalFeatures&&typeof s.vocalFeatures==="object"&&!Array.isArray(s.vocalFeatures)?s.vocalFeatures as Record<string,unknown>:null;
 const vocalStatus=String(vocalFeatures?.status??"not_recorded");
 const vocalAnalysisPerformed=Boolean(vocalFeatures&&["analyzed","measured","completed"].includes(vocalStatus));
 const sonicDnaBody: string[] = [];
 if (hasAudio) {
  sonicDnaBody.push(e.fixture ? "FIXTURE VALUES — synthetic audio-profile test data" : "The Sonic DNA dashboard separates confidence-qualified measurements from provisional candidates and unavailable results. Only measurements that pass their metric-specific reliability gate are presented as confirmed.");
  if (e.fixture !== true) sonicDnaBody.push("Mood classification: Not performed — no validated audio mood model is configured. RMS level, spectral centroid and zero-crossing rate are signal descriptors, not emotional mood indicators.");
  if (vocalAnalysisPerformed) {
   const vocalSegments=Array.isArray(vocalFeatures?.activitySegments)?vocalFeatures.activitySegments.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"&&!Array.isArray(item))):[];
   const segmentSummary=vocalSegments.slice(0,8).map((segment)=>metric(segment.startSeconds,2)+"–"+metric(segment.endSeconds,2)+" s").join("; ");
   const pitch=vocalFeatures?.pitch&&typeof vocalFeatures.pitch==="object"?vocalFeatures.pitch as Record<string,unknown>:{};
   const pitchRange=typeof pitch.lowerHz==="number"&&typeof pitch.upperHz==="number"
    ?metric(pitch.lowerHz,0)+"–"+metric(pitch.upperHz,0)+" Hz (median "+metric(pitch.medianHz,0)+" Hz)":"Not determined";
   sonicDnaBody.push(
    "Vocal presence: "+val(vocalFeatures?.voicePresence,"Not determined")
    +"; estimated activity: "+(typeof vocalFeatures?.vocalActivityRatio==="number"?(vocalFeatures.vocalActivityRatio*100).toFixed(1)+"%":"Not measured")
    +"; active duration: "+metric(vocalFeatures?.activeDurationSeconds,2)+" s"
    +(segmentSummary?"; activity intervals: "+segmentSummary:"")
    +"; estimated fundamental-frequency candidates: "+pitchRange
    +"; delivery: "+val(vocalFeatures?.delivery,"Not classified")
    +"; layering: "+val(vocalFeatures?.layering,"Not classified")
   );
  }
 } else if (s) {
  sonicDnaBody.push("Provider-supplied sonic context is catalogue metadata and is not substituted for measurements from an uploaded master.");
  const providerMoodTags=Array.isArray(s.moodTags)?s.moodTags.map(text).filter(Boolean):[];
  if(providerMoodTags.length&&s.provenance==="tidal_catalog_metadata")sonicDnaBody.push("Provider-supplied catalogue mood descriptors: "+providerMoodTags.join(", ")+" [Source: TIDAL].");
 } else if (hasMasterAudio) {
  sonicDnaBody.push("An uploaded master was supplied, but completed master-derived measurements are not available in this report.");
 } else {
  sonicDnaBody.push("No uploaded master was supplied; tempo, key/mode, loudness and spectral measurements require the recording itself.");
  sonicDnaBody.push("Required next input: upload the actual master audio file. Do not infer genre, production quality or mastering readiness from DSP metadata alone.");
 }

 const playlistCandidateLines=["spotify","apple_music"].flatMap((providerKey)=>{
 const providerItems=playlistCandidates.filter((item)=>text(item.provider)===providerKey);
 if(!providerItems.length)return [];
 const providerHeading=providerKey==="spotify"?"SPOTIFY PLAYLIST RESULTS":"APPLE MUSIC PLAYLIST RESULTS";
 return [providerHeading,...providerItems.flatMap((target,index)=>{
  const name=text(target.name),provider=providerKey==="spotify"?"Spotify":"Apple Music",url=text(target.url),basis=Array.isArray(target.matchBasis)?target.matchBasis.map(text).filter(Boolean):[];
  const presence=target.containsIsrc===true?"The audited ISRC is already present; treat this as existing playlist presence, not an outreach prospect."
   :target.containsIsrc===false?"The inspected playlist tracks did not include this ISRC; this is not proof that the recording is absent from every playlist version."
   :"Playlist track membership was not inspected completely by this provider."; 
  return [
   "AVAILABLE PLAYLIST "+(index+1)+": "+name+" - "+provider,
   "Alignment: "+(basis.join("; ")||"No match rationale supplied"),
   "Playlist owner / curator: "+(text(target.curatorName)||"Not supplied")+"; playlist type: "+(text(target.playlistType)||"Not supplied")+"; track count: "+(text(target.trackCount)||"Not supplied"),
   presence,
   ...(Array.isArray(target.moodMatches)&&target.moodMatches.length?["Mood evidence source: "+(text(target.moodSource)||"source not supplied")]:[]),
   "Playlist source: "+url+"; checked: "+(text(target.retrievedAt)||"retrieval time not supplied")
  ];
 })];
});
const curatorCampaignBody=[
  ...(verifiedCuratorTargets.length?verifiedCuratorTargets.flatMap((target,index)=>[
   "VERIFIED CURATOR TARGET "+(index+1)+": "+text(target.name)+" — "+text(target.platform),
   "Fit rationale: "+text(target.fitRationale),
   "Official submission route: "+text(target.submissionRoute),
   "Published requirements: "+text(target.submissionRequirements),
   "Official source: "+text(target.sourceUrl),
   "Verified on: "+text(target.verifiedAt)
  ]):["No named curator contact or official submission opportunity has been independently verified. Playlist catalog availability does not establish an open submission route, acceptance or placement."]),
  ...(playlistOutcomes.length?["DSP playlist-search outcomes: "+playlistOutcomes.map((outcome)=>text(outcome.provider)+" — "+text(outcome.status)+" — "+text(outcome.reason)).join("; ")]:[]),
  "Playlist discovery is a targeting aid only; it does not establish curator interest, editorial acceptance, placement, audience size or commercial performance."
 ];
 const reconciliation=e.reconciliation&&typeof e.reconciliation==="object"?e.reconciliation as Record<string,unknown>:{};
 const conflictSummary=Array.isArray(reconciliation.conflicts)?reconciliation.conflicts.map((item)=>{const conflict=item&&typeof item==="object"?item as Record<string,unknown>:{};return text(conflict.field)+": "+(Array.isArray(conflict.values)?conflict.values.map(text).join(" vs "):"Conflicting values");}).join("; "):"No conflict details supplied";
 const score=(name:string,v:{score:number|null;rationale:string})=>name+" — "+(v.score===null?"NOT SCORED":v.score+"/100")+" — "+v.rationale;
 const output:Section[]=[
 {title:"Executive assessment",accent:"blue",body:[...(e.fixture?["FIXTURE — synthetic renderer test data; not a real analysis."]:[]),a.executiveSummary,"Verdict: "+verdictLabel(a.commercialRead.marketability),"Verdict rule: "+verdictRule(a.commercialRead.marketability),"Reason: "+a.commercialRead.rationale,"Assessment confidence: a model-generated evidence-quality indicator informed by source coverage, agreement and stated limitations; it is not a calibrated probability or a commercial-success forecast.","Assessment basis: "+(e.fixture?"Synthetic renderer fixture — no real master or identity evidence.":hasMasterAudio?"Uploaded master submitted; master-derived measurements are reported separately.":"Metadata/provider evidence only; no uploaded master."),"Submitted source combination: "+sourceCombinationLabel ]},
 {title:"Identity and source reconciliation",accent:"violet",body:[
 ...(["artist","title","album","genre","isrc","upc","label","releaseDate"] as const).map((field)=>({artist:"Artist",title:"Track",album:"Album",genre:"Genre",isrc:"ISRC",upc:"UPC",label:"Label",releaseDate:"Release date"}[field])+": "+metadataFieldStatus(e,field)+" — "+(text(field==="genre"?(e.genre??e.genres):e[field])||"No value returned by the supplied or queried sources")+" — "+metadataFieldSource(e,field)),
 "DSP provider lookup outcomes: "+providerLookupSummary,
 "Platform presence and consistency: "+platformPresenceSummary,
 "Conflict policy: values that disagree across providers remain visible as conflicts; a preferred identity value is not treated as proof that the other provider was wrong.",
 "Conflict details: "+conflictSummary,
 "External identifiers: "+(externalIdentifiers(e.externalIds)?(e.fixture?"Synthetic test identifiers — ":"Available — ")+externalIdentifiers(e.externalIds):"Unavailable — no external identifiers returned"),
 "Sources checked: "+val((Array.isArray(e.metadataSourcesChecked)?e.metadataSourcesChecked:Array.isArray(e.sourceProviders)?e.sourceProviders:Array.isArray(e.sources)?e.sources:null)?.filter((provider)=>provider!=="synthetic_audio_fixture").map((provider)=>({spotify:"Spotify",tidal:"TIDAL",apple_music:"Apple Music",deezer:"Deezer",youtube_music:"YouTube Music",audiomack:"Audiomack",musicbrainz:"MusicBrainz",id3:"Embedded audio tags",filename:"Uploaded filename",audd:"Audio recognition"} as Record<string,string>)[String(provider)]??String(provider)).join(", ")||"No external metadata sources were checked"),
 "Coverage status: "+val(e.evidenceStatus??e.status,"Partial — one or more identity fields remain unavailable"),
 "Verification note: unavailable fields are not inferred or fabricated. Analytical recommendations remain hypotheses and are never presented as verified identity metadata.",
 e.isrc ? "ISRC-led catalogue read: the recording code is used to join MusicBrainz and configured DSP catalogue records; source-specific conflicts and field provenance are retained above." : "No ISRC-led catalogue join was available for this recording.",
 e.isrc ? "Marketing application: use the reconciled recording identity and provider-backed genre lanes to search current DSP playlist catalogues. Where returned, candidate playlists are listed in A&R positioning; catalogue presence is not evidence of demand or campaign results." : "Marketing targeting remains limited until a recording-level identifier is available."
]},
 {title:"Evidence ledger and provenance",accent:"teal",body:a.evidenceLabels.map(x=>(({OBSERVED:"Measured from the uploaded master",RECOGNIZED:"Returned by an external identification source",RECONCILED:"Cross-checked across independent sources",INFERRED:"Analytical hypothesis — not independently verified","INDUSTRY PRACTICE":"General industry guidance"} as Record<string,string>)[x.label]??"Evidence item")+" — "+x.claim+" [Source: "+x.source+"]")},
 {title:"Sonic DNA and technical profile",accent:"blue",body:["AUDIT EXECUTION MODE: "+(i.executionMode==="dsp_link"?"METADATA-ONLY — no uploaded master was analysed; Sonic DNA measurements are not claimed.":i.executionMode==="combined"?"COMBINED — uploaded master measurements are separate from DSP catalogue records.":i.executionMode==="master"?"UPLOADED MASTER — direct signal measurements are derived from the submitted audio.":sourceCombinationLabel),...sonicDnaBody]},
 ...(i.realMasterContract? [{
  title:"Master evidence contract and provenance",accent:"teal" as const,
  body:[
   "SOURCE FILE: "+i.realMasterContract.source.sourceAudioPath,
   "SOURCE SHA-256: "+i.realMasterContract.source.sha256,
   "SOURCE MIME / SIZE: "+i.realMasterContract.source.mimeType+" / "+i.realMasterContract.source.byteLength+" bytes",
   ...i.realMasterContract.directSignalMeasurements.map((m)=>m.name+": "+(m.status==="measured"?text(m.value)+" "+m.unit+"; method "+m.method:"UNAVAILABLE; "+m.diagnostics.map((d)=>d.code+": "+d.message).join("; "))),
   ...i.realMasterContract.calibratedPredictions.map((p)=>p.name+": "+(p.status==="predicted"?p.label+" ("+(p.probability*100).toFixed(1)+"% calibrated; "+p.calibration.validationDataset+")":"UNAVAILABLE; "+p.reasonCodes.join(", ")+" — "+p.diagnostics.map((d)=>d.message).join("; "))),
   ...i.realMasterContract.externalRecords.map((r)=>r.status==="verified"?"EXTERNAL RECORD: "+r.provider+" / "+r.recordId+"; fields: "+Object.keys(r.fields).join(", "):"EXTERNAL RECORD UNAVAILABLE: "+r.provider+" — "+r.reasonCode+": "+r.diagnostic.message),
   ...i.realMasterContract.pipelineDiagnostics.map((d)=>"PIPELINE LIMITATION: "+d.code+" — "+d.message),
   "Provenance rule: direct signal measurements are observed from the uploaded master; catalogue records are provider-returned and do not establish streams, listeners, revenue or demand."
  ]
 }] : []),
 {title:"Creative identity and A&R positioning",accent:"violet",body:["Provider-backed genre evidence: "+primaryGenre+(genreSources.length?"; contributing sources: "+genreSources.join(", "):""),a.creativeIdentity.replace(/automated classification model has abstained/gi,""),"Primary lane: "+a.aAndRPositioning.primaryLane,"Adjacent lanes: "+(a.aAndRPositioning.adjacentLanes.length?a.aAndRPositioning.adjacentLanes.join(", "):"Not established — no supported adjacent-lane evidence is available."),
 ...(playlistCandidateLines.length?["DSP playlist candidates aligned to the confirmed genre/adjacent lanes:",...playlistCandidateLines]:["No aligned DSP playlist candidates are currently available from the configured catalogue search APIs."]),
 playlistMoodSummary,
 a.aAndRPositioning.rationale]},
 {title:"Strengths and creative leverage",accent:"teal",body:a.strengths.length?a.strengths:["No audio-measured strengths are asserted without an uploaded master."]},
 {title:"Risks and diligence",accent:"coral",body:a.risks},
 {title:"Evidence-derived scorecard",accent:"blue",body:[score("Tempo and lane fit",a.scorecard.tempoLaneFit),score("Rhythmic consistency",a.scorecard.rhythmicConsistency),score("RMS-envelope spread and RMS signal level",a.scorecard.dynamicRangeLoudness),score("Metadata completeness",a.scorecard.metadataCompleteness),score("Release readiness",a.scorecard.releaseReadiness)]},
 {title:"Human listening checklist (unscored)",accent:"violet",body:a.humanListeningChecklist},
 {title:"Production and arrangement guidance",accent:"teal",body:[a.productionArrangementGuidance,industryPractice("General lane craft knowledge, not track-specific evidence."),industryPractice(a.industryPractice),...a.listeningChecks]},
 {title:"Comparable lanes and listening references to verify",accent:"violet",body:["Analytical hypotheses — comparisons not independently verified",a.laneHypothesis,...a.referencesToVerify,a.verificationMethod]},
 {title:"Promotion plan",accent:"coral",body:[a.promotionPlan.preRelease,a.promotionPlan.releaseWindow,a.promotionPlan.postRelease,"Content concepts: "+a.promotionPlan.contentIdeas.join(" • "),"General pitching guidance — angles to adapt to verified track facts: "+a.promotionPlan.pitchingAngles.join(" • "),industryPractice(a.promotionPlan.industryPractice)]},
 {title:"Curator campaign and target verification",accent:"coral",body:curatorCampaignBody},
 {title:"Label and partner fit",accent:"blue",body:[a.labelPartnerFit.partnerProfile,...a.labelPartnerFit.criteriaToDemonstrate,a.labelPartnerFit.diligenceBeforeContact,industryPractice(a.labelPartnerFit.industryPractice)]},
 {title:"30 / 60 / 90-day execution plan",accent:"violet",body:["DAYS 01–30 — "+a.executionPlan.days30,"DAYS 31–60 — "+a.executionPlan.days60,"DAYS 61–90 — "+a.executionPlan.days90]},
 {title:"Commercial evidence, measurement and decision gates",accent:"blue",body:["Catalog popularity: "+val(e.catalogPopularity),"Audience telemetry: "+val(e.audienceTelemetry),"DECISION RECORD",a.releaseStrategy.recommendation,...a.releaseStrategy.priorities.map((p,n)=>"Priority "+(n+1)+": "+p),"Evidence gaps: "+a.evidenceGaps.join(" "),"Limitations: "+a.limitations.join(" ")]}
 ];
 return output.map((section)=>({...section,body:section.body.map(professionalEvidenceLanguage).filter((paragraph)=>paragraph.trim().length>0)}));
}
export function chartLayoutIssuesForReport(input:AuditReportInput):string[]{
 const issues:string[]=[];for(const section of sections(input)){for(const panel of chartsForSection(input,section.title)){issues.push(...chartPanelLayoutErrors(panel.kind??"bars",panel.rows,M,TOP,chartPanelHeight(panel.kind,panel.rows)));}}return issues;
}
export function planAuditReportPages(input:AuditReportInput,tier:AuditReportTier):ReportPagePlan[]{const all=sections(input);return (tier==="sample"?all.slice(0,8):all).map(s=>({title:s.title,text:s.body}));}
export async function generateAuditReport(input:AuditReportInput,tier:AuditReportTier,signal?:AbortSignal):Promise<Uint8Array>{
 signal?.throwIfAborted();
 const pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf);
 signal?.throwIfAborted();
 cover(pdf,input,fonts);
 const selected=tier==="sample"?sections(input).slice(0,8):sections(input);
 const estimatedHeight=selected.reduce((total,section)=>{
  const titleHeight=wrap(section.title,fonts.bold,19.5,W-2*M-34).length*25+10;
  const bodyHeight=section.body.reduce((sum,para)=>{
   const size=para===para.toUpperCase()&&para.length<100?8:9.7,lineHeight=size*1.4;
   const lineCount=wrap(para,fonts.regular,size,W-2*M-16).length;
   const perPage=Math.max(1,Math.floor((AVAILABLE-50)/lineHeight));
   return sum+lineCount*lineHeight+Math.ceil(lineCount/perPage)*8;
  },0);
  return total+titleHeight+bodyHeight+12;
 },0);
 const chartAllowance=selected.reduce((n,section)=>n+chartsForSection(input,section.title).reduce((sum,p)=>sum+chartPanelHeight(p.kind,p.rows)+14,0),0);
 const totalEstimatedHeight=estimatedHeight+chartAllowance;
 const plannedPages=Math.max(1,Math.ceil(totalEstimatedHeight/(AVAILABLE*.9)));
 if(plannedPages>18)console.warn("[report-layout] Estimated report body exceeds the preferred page plan:",plannedPages);
 let pageNo=1,page=pdf.addPage([W,H]),y=TOP,rects:ReportRect[]=[];
 header(page,"Audit findings",pageNo,fonts,C.blue,input.evidence.fixture===true);
 const chromeRects=():ReportRect[]=>[{x:M,y:H-44,width:220,height:10,id:"header-brand"},{x:M,y:H-64,width:W-2*M,height:8,id:"header-title"},{x:M,y:H-68,width:W-2*M,height:0.7,id:"header-rule"},{x:M,y:43,width:W-2*M,height:0.7,id:"footer-rule"},{x:M,y:25,width:250,height:10,id:"footer-text"},{x:W-M-18,y:25,width:18,height:10,id:"footer-page-number"}];
 const validate=(checkDensity=true)=>{const layout=checkLayout([...chromeRects(),...rects]);if(!layout.ok)console.warn("[report-layout] Page "+pageNo+" layout warnings:",layout.errors);if(!checkDensity)return;const density=checkPageDensity(rects);if(!density.ok||1-density.emptyRatio<.6)console.warn("[report-layout] Page "+pageNo+" content occupancy is below the 60% minimum target ("+Math.round((1-density.emptyRatio)*100)+"%).");};
 const nextPage=(title:string,accent:typeof C[keyof typeof C],checkDensity=true)=>{validate(checkDensity);pageNo++;page=pdf.addPage([W,H]);header(page,title,pageNo,fonts,accent,input.evidence.fixture===true);y=TOP;rects=[];};
 for(let si=0;si<selected.length;si++){
  const section=selected[si],accent=C[section.accent],titleLines=wrap(section.title,fonts.bold,19.5,W-2*M-34),titleH=titleLines.length*25+10;
  const sonicBlock=section.title==="Sonic DNA and technical profile";
  const keepTogetherCount=section.title==="Curator campaign and target verification"?Math.min(3,section.body.length)
    :section.title==="Creative identity and A&R positioning"?Math.min(4,section.body.length)
    :section.title==="Human listening checklist (unscored)"?Math.min(5,section.body.length)
    :chartsForSection(input,section.title).length?Math.min(2,section.body.length):Math.min(1,section.body.length);
  const openingHeight=section.body.slice(0,keepTogetherCount).reduce((sum,para)=>{
   const size=para===para.toUpperCase()&&para.length<100?8:9.7;
   return sum+wrap(para,fonts.regular,size,W-2*M-16).length*size*1.4+8;
  },0);
  const sonicHeight=sonicBlock?section.body.reduce((sum,p)=>{const size=p===p.toUpperCase()&&p.length<100?8:9.7;return sum+wrap(p,fonts.regular,size,W-2*M-16).length*size*1.4+8;},0):0;
  // Keep the section heading with its opening two paragraphs when possible, preventing
  // a heading/first-paragraph orphan while still allowing genuinely long sections to flow.
  if(y-titleH-openingHeight<BOTTOM+30||(sonicBlock&&y-titleH-sonicHeight<BOTTOM+45))nextPage(section.title,accent);
  const titleRect={x:M,y:y-titleH,width:W-2*M,height:titleH,id:"section-title-"+si};rects.push(titleRect);
  page.drawText(String(si+1).padStart(2,"0"),{x:M,y:y-2,size:8,font:fonts.bold,color:accent});
  let ty=y;for(const line of titleLines){page.drawText(line,{x:M+34,y:ty,size:19.5,font:fonts.bold,color:C.navy});ty-=25;}y=ty-10;
  for(let pi=0;pi<section.body.length;pi++){
   const para=section.body[pi],size=para===para.toUpperCase()&&para.length<100?8:(section.title==="Decision record and evidence gates"?9.0:9.7);
   const lines=wrap(para,fonts.regular,size,W-2*M-16),lineHeight=size*(section.title==="Decision record and evidence gates"?1.2:1.4);
   let offset=0,chunk=0;
   while(offset<lines.length){
    let capacity=Math.floor((y-BOTTOM-8)/lineHeight);
    if(capacity<1){nextPage(section.title,accent);capacity=Math.floor((y-BOTTOM-8)/lineHeight);}
    const paragraphGap=section.title==="Decision record and evidence gates"?3:8;
    const fullParagraphHeight=lines.length*lineHeight+paragraphGap;
    if(offset===0&&fullParagraphHeight<=AVAILABLE&&fullParagraphHeight>y-BOTTOM-8){nextPage(section.title,accent);capacity=Math.floor((y-BOTTOM-8)/lineHeight);}
    const count=Math.min(capacity,lines.length-offset),height=count*lineHeight+paragraphGap;
    const r={x:M,y:y-height,width:W-2*M,height,id:"section-"+si+"-paragraph-"+pi+"-part-"+chunk};rects.push(r);

    for(let li=0;li<count;li++){
      const line=lines[offset+li],spotifyAttribution=(offset+li===0&&line==="SPOTIFY PLAYLIST RESULTS")||(offset+li===0&&/^AVAILABLE PLAYLIST/.test(line)&&/ - Spotify$/.test(line));
      const textX=M+(spotifyAttribution?31:8);
      if(spotifyAttribution)drawSpotifyMark(page,M+8,y-li*lineHeight-4,18);
      if(fonts.regular.widthOfTextAtSize(line,size)>W-textX-M+.01)console.warn("[report-layout] Text width overflow:",r.id);
      page.drawText(line,{x:textX,y:y-li*lineHeight,size,font:fonts.regular,color:size<9?accent:C.ink});
     }
    y-=height;offset+=count;chunk++;
    if(offset<lines.length)nextPage(section.title,accent);
   }
  }
  for(const panel of chartsForSection(input,section.title)){
   const panelHeight=chartPanelHeight(panel.kind,panel.rows);
   const layoutIssues=chartPanelLayoutErrors(panel.kind??"bars",panel.rows,M,y-8,panelHeight);if(layoutIssues.length)console.warn("[report-layout] Chart layout warnings:",layoutIssues);
   // Keep the chart on this page whenever its complete card clears the footer; low page fill alone is not a reason to orphan it.
   if(y-8-panelHeight<BOTTOM+45){
    nextPage(section.title,accent,false);
    const visualHeading=wrap(section.title,fonts.bold,14,W-2*M-20);
    visualHeading.forEach((part,index)=>page.drawText(part,{x:M+8,y:TOP-20-index*18,size:14,font:fonts.bold,color:accent}));
    page.drawText("Visual summary of the evidence and recommendations in this section.",{x:M+8,y:TOP-20-visualHeading.length*18,size:9.7,font:fonts.regular,color:C.muted});
    rects.push({x:M+8,y:TOP-20-visualHeading.length*18-5,width:W-2*M-16,height:visualHeading.length*18+30,id:"chart-context-"+si});
    y=TOP-20-visualHeading.length*18-35;
   }
   const panelTop=y-8;
   drawChartPanel(page,{...panel,fixture:input.evidence.fixture===true,y:panelTop},fonts.regular,fonts.bold);
   rects.push({x:M,y:panelTop-panelHeight,width:W-2*M,height:panelHeight,id:"chart-"+si+"-"+panel.title.replace(/\s+/g,"-")});
   y=panelTop-panelHeight-14;
  }
  y-=12;
 }
 // Render the same decision context on either notes path. Long summaries continue
 // across context pages; the editable notes field remains a single widget on the final page.
 const form=pdf.getForm(),field=form.createTextField("ar_notes");field.enableMultiline();
 const decisionContext=buildArNotesDecisionContext(input);
 const allSummaryLines=wrap(decisionContext.summary,fonts.regular,8.2,W-2*M-28);
 const drawDecisionContext=(target:PDFPage,topY:number,shouldDraw=true,summaryLines=allSummaryLines,includePrompts=true):{rects:ReportRect[];bottom:number}=>{
  const cardHeight=50+summaryLines.length*11,cardBottom=topY-cardHeight;
  if(shouldDraw){
   target.drawRectangle({x:M,y:cardBottom,width:W-2*M,height:cardHeight,color:C.paper,borderColor:C.line,borderWidth:.7});
   target.drawText(decisionContext.heading,{x:M+14,y:topY-14,size:7,font:fonts.bold,color:C.violet});
   target.drawText(decisionContext.verdict,{x:M+14,y:topY-36,size:12,font:fonts.bold,color:C.navy});
  }
  let summaryY=topY-54;
  for(const line of summaryLines){if(shouldDraw)target.drawText(line,{x:M+14,y:summaryY,size:8.2,font:fonts.regular,color:C.ink});summaryY-=11;}
  const rects:ReportRect[]=[{x:M,y:cardBottom,width:W-2*M,height:cardHeight,id:"decision-context"}];
  if(!includePrompts)return {rects,bottom:cardBottom};
  const promptsTitleY=cardBottom-18;
  if(shouldDraw)target.drawText("REVIEW PROMPTS",{x:M,y:promptsTitleY,size:7,font:fonts.bold,color:C.violet});
  rects.push({x:M,y:promptsTitleY-3,width:220,height:10,id:"review-prompts-title"});
  let promptY=promptsTitleY-17,bottom=promptY;
  for(let index=0;index<decisionContext.prompts.length;index++){
   const lines=wrap(decisionContext.prompts[index],fonts.regular,7.5,W-2*M-24);
   const height=lines.length*10;
   for(let line=0;line<lines.length;line++)if(shouldDraw)target.drawText((line===0?"- ":"  ")+lines[line],{x:M+8,y:promptY-line*10,size:7.5,font:fonts.regular,color:C.muted});
   rects.push({x:M+8,y:promptY-height+2,width:W-2*M-16,height:height,id:"review-prompt-"+index});
   bottom=Math.min(bottom,promptY-height+2);
   promptY-=height+4;
  }
  return {rects,bottom};
 };
 const notesFieldBottom=BOTTOM+12,notesTitleY=y-18,notesSubtitleY=notesTitleY-25;
 const inlineContextTop=notesSubtitleY-32;
 const inlineLayout=drawDecisionContext(page,inlineContextTop,false,allSummaryLines,true);
 const inlineFieldTop=inlineLayout.bottom-18;
 const inlineNotesHeight=inlineFieldTop-notesFieldBottom;
 if(inlineNotesHeight>=180){
  const inlineContext=drawDecisionContext(page,inlineContextTop,true,allSummaryLines,true);
  page.drawText("A&R NOTES",{x:M,y:notesTitleY,size:16,font:fonts.bold,color:C.violet});
  page.drawText("Private working notes — editable field",{x:M,y:notesSubtitleY,size:8.5,font:fonts.regular,color:C.muted});
  field.addToPage(page,{x:M,y:notesFieldBottom,width:W-2*M,height:inlineNotesHeight,borderWidth:1,borderColor:C.violet,backgroundColor:C.white});
  field.setFontSize(9);field.updateAppearances(fonts.regular);
  rects.push(
   {x:M,y:notesTitleY-4,width:220,height:20,id:"notes-title"},
   {x:M,y:notesSubtitleY-3,width:300,height:12,id:"notes-subtitle"},
   ...inlineContext.rects,
   {x:M,y:notesFieldBottom,width:W-2*M,height:inlineNotesHeight,id:"A&R notes field"}
  );
  validate();
 }else{
  // A compact continuation marker fills the intentional transition space and tells readers
  // exactly where the complete decision context and editable notes field continue.
  if(y-BOTTOM>=70){
   const markerText="A&R NOTES CONTINUE — decision context, review prompts and editable working field follow on the next page.";
   const markerY=y-58;
   page.drawRectangle({x:M,y:markerY,width:W-2*M,height:46,color:C.paper,borderColor:C.line,borderWidth:.7});
   const markerLines=wrap(markerText,fonts.regular,8,W-2*M-24);
   markerLines.forEach((line,index)=>page.drawText(line,{x:M+12,y:markerY+29-index*11,size:8,font:fonts.regular,color:C.navy}));
   rects.push({x:M,y:markerY,width:W-2*M,height:46,id:"notes-continuation-marker"});
  }
  // This final body page intentionally hands off to a dedicated notes section;
  // the density heuristic is applied to the following notes pages instead.
  validate(false);
  // Keep at most 42 summary lines on continuation pages and at most 16 on the final
  // notes page, leaving room for all prompts and a meaningful editable field.
  const summaryChunks=paginateArNotesSummary(allSummaryLines);
  for(let chunkIndex=0;chunkIndex<summaryChunks.length;chunkIndex++){
   const isLast=chunkIndex===summaryChunks.length-1;
   const notes=pdf.addPage([W,H]);pageNo++;
   header(notes,chunkIndex===0?"A&R notes":"A&R notes continued",pageNo,fonts,C.violet,input.evidence.fixture===true);
   notes.drawText("A&R NOTES",{x:M,y:TOP,size:20,font:fonts.bold,color:C.navy});
   notes.drawText(chunkIndex===0?"Private working notes — editable field":"DECISION CONTEXT — CONTINUED",{x:M,y:TOP-27,size:9,font:fonts.regular,color:C.muted});
   const notesContext=drawDecisionContext(notes,TOP-105,true,summaryChunks[chunkIndex],isLast);
   const noteRects:ReportRect[]=[
    {x:M,y:TOP-4,width:220,height:24,id:"notes-title"},
    {x:M,y:TOP-32,width:300,height:14,id:"notes-subtitle"},
    ...notesContext.rects
   ];
   if(isLast){
    const notesFieldY=145,notesFieldTop=notesContext.bottom-18,rawNotesFieldHeight=notesFieldTop-notesFieldY,notesFieldHeight=Math.max(80,rawNotesFieldHeight);
    if(rawNotesFieldHeight<160)console.warn("[report-layout] A&R Notes field is below the preferred height:",rawNotesFieldHeight);
    field.addToPage(notes,{x:M,y:notesFieldY,width:W-2*M,height:notesFieldHeight,borderWidth:1,borderColor:C.violet,backgroundColor:C.white});
    field.setFontSize(9);field.updateAppearances(fonts.regular);
    noteRects.push({x:M,y:notesFieldY,width:W-2*M,height:notesFieldHeight,id:"A&R notes field"});
   }
   const notesCheck=checkLayout([...chromeRects(),...noteRects]);if(!notesCheck.ok)console.warn("[report-layout] A&R Notes layout warnings:",notesCheck.errors);
   const notesDensity=checkPageDensity(noteRects);if(!notesDensity.ok)console.warn("[report-layout] A&R Notes page density is below the preferred threshold.");
  }
 }
 if(tier==="full"&&pdf.getPageCount()<10)console.warn("[report-layout] Full report is below the preferred 10-page target:",pdf.getPageCount());
 if(pdf.getPageCount()>20)console.warn("[report-layout] Report exceeds the preferred 20-page target:",pdf.getPageCount());
 signal?.throwIfAborted();
 const bytes=await pdf.save();
 signal?.throwIfAborted();
 return bytes;
}
