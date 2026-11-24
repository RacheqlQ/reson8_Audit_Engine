import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { buildArNotesDecisionContext, buildArNotesDecisionContextFull, chartsForSection, metadataFieldStatus, metadataFieldSource, reconciledAssessmentItems, type AuditReportInput, type AuditReportTier } from "../generate-audit-report.js";
import { loadReportFonts } from "../fonts.js";
import { chartEvidenceIntegrityErrors, chartPanelHeight, countEvidenceLayers, drawChartPanel, draw3DSolidBar, draw3DSolidSphere } from "../charts.js";
import { reconcileChartCrossChecks, reconcileChartSeriesAndLabels } from "../chart-reconciliation.js";
import { adaptReportV2, type ReportV2Data, type TimedPoint } from "./adapters.js";
import { hasSubmittedMasterAudio } from "../../audio/master-audio-evidence.js";
import { hasReportableKeyCandidates, isReliableKey, isReliableTempo } from "../evidence-guardrails.js";
import { sanitizeAssessmentForEvidence } from "../evidence-guardrails.js";
import { sanitizePublicReportLines, sanitizePublicReportLine } from "./public-language.js";
import { buildReconciledArIntelligence } from "./reconciled-ar-intelligence.js";

const W=595.28,H=841.89,M=42;
const SNAPSHOT_METRIC_CARD_HEIGHT=104,SNAPSHOT_KEY_MAP_HEIGHT=154,SNAPSHOT_VOCAL_MODULE_HEIGHT=260,SNAPSHOT_OVERVIEW_HEIGHT=105;
const C={
 paper:rgb(247/255,243/255,236/255),white:rgb(1,1,1),ink:rgb(43/255,40/255,37/255),
 muted:rgb(108/255,101/255,92/255),line:rgb(226/255,219/255,207/255),
 charcoal:rgb(43/255,40/255,37/255),gold:rgb(176/255,141/255,87/255),
 teal:rgb(29/255,158/255,117/255),label:rgb(138/255,106/255,48/255),amber:rgb(239/255,159/255,39/255),coral:rgb(216/255,90/255,48/255),violet:rgb(99/255,107/255,184/255)
};
type Fonts={regular:PDFFont;bold:PDFFont;italic:PDFFont;boldItalic:PDFFont};
export type ProposedArrangementSegment={label:string;startPct:number;endPct:number;intensity:number;emotion:string};
export type Block={label:string;value:string;provenance?:string;confidence?:string;color?:keyof typeof C;arrangementBar?:ProposedArrangementSegment[]};
type PageSpec={title:string;blocks:Block[];lines?:string[];kind?:string};
const rec=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
export function normalizePdfText(value:string):string {
 return value
  .replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201c\u201d]/g,'"')
  .replace(/[\u2013\u2014]/g,"-")
  .replace(/\u2026/g,"...")
  .replace(/\u2022/g,"-")
  .replace(/\u00a0/g," ")
  .replace(/\u20a6/g,"NGN ")
  .replace(/[^\u0000-\u00ff]/gu,"?");
}
const str=(v:unknown,fallback="Not supplied")=>typeof v==="string"&&v.trim()?normalizePdfText(v.trim()):typeof v==="number"&&Number.isFinite(v)?String(v):fallback;
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const INTERNAL_ANALYSIS_STATUS = /(?:vocal analysis.{0,80}(?:temporarily disabled|not performed|unavailable|disabled|not run)|vocal presence(?:\s*\/\s*absence)? is unknown|no vocal conclusion is available|learned audio model.{0,40}disabled|detection model.{0,40}disabled)/i;
export function publicReportLimitations(value: unknown): string[] {
 return arr(value).map(item=>str(item,"")).filter(line=>line&&!INTERNAL_ANALYSIS_STATUS.test(line));
}
const dateText=(v:unknown)=>{const s=str(v,"");return s?s.slice(0,10):"Date not supplied";};
function wrap(value:string,font:PDFFont,size:number,width:number):string[]{
 const words=normalizePdfText(value).replace(/\s+/g," ").split(" ").filter(Boolean),out:string[]=[];let line="";
 for(const word of words){
  let token=word;
  if(font.widthOfTextAtSize(token,size)>width){
   if(line){out.push(line);line="";}
   let part="";for(const ch of token){if(font.widthOfTextAtSize(part+ch,size)>width&&part){out.push(part);part=ch;}else part+=ch;}token=part;
  }
  const next=line?line+" "+token:token;
  if(font.widthOfTextAtSize(next,size)>width&&line){out.push(line);line=token;}else line=next;
 }
 if(line)out.push(line);return out;
}
function drawWrapped(page:PDFPage,value:string,x:number,y:number,width:number,font:PDFFont,size=9,color=C.ink,lineHeight=size*1.35):number{
 const lines=wrap(value,font,size,width);lines.forEach((line,i)=>page.drawText(line,{x,y:y-i*lineHeight,size,font,color}));return lines.length*lineHeight;
}
function isResolvedKeyLabel(value:unknown):boolean{
 if(typeof value!=="string"||!value.trim())return false;
 return !/^(?:n\s*\/\s*d|not determined|unavailable|unknown)$/i.test(value.trim());
}
export function buildRecordingOverviewKeyLabel(data:ReportV2Data):string{
 if(isResolvedKeyLabel(data.key.value))return String(data.key.value);
 const resolution=data.tonalResolution;
 if(resolution?.status==="PROVISIONAL"&&resolution.tonic&&resolution.mode)
  return "Provisional: "+resolution.tonic+" "+resolution.mode;
 if(resolution?.status==="UNAVAILABLE")return "Unavailable";
 return "Not determined";
}
export function buildCoverKeyLabel(input:AuditReportInput,data:ReportV2Data):string{
 const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
 // The adapted resolution is the report's canonical tonal state. Prefer it to
 // legacy key strings and raw candidate guardrails so the cover cannot diverge
 // from the recording overview or Circle of Fifths when legacy fields are stale.
 const resolution=rec(data.tonalResolution??input.tonalResolution??harmonic.tonalResolution??rec(input.sonicDna).tonalResolution);
 const tonic=str(resolution.tonic,"");
 const mode=str(resolution.mode,"");
 if(resolution.status==="UNAVAILABLE")return "Unavailable";
 if(resolution.status==="CONFIRMED"&&tonic&&mode)return tonic+" "+mode;
 if(resolution.status==="PROVISIONAL"&&tonic&&mode)return "Possible: "+tonic+" "+mode;
 if(isResolvedKeyLabel(data.key.value))return String(data.key.value);
 const tonalAudio={...rec(input.sonicDna),tonalResolution:resolution};
 const candidates=hasReportableKeyCandidates(tonalAudio)
  ?(arr(resolution.candidates).length?arr(resolution.candidates):arr(harmonic.topCandidates)).map(value=>rec(value)):[];
 const first=candidates.find(item=>(typeof item.key==="string"&&item.key.trim())||(typeof item.tonic==="string"&&item.tonic.trim()));
 if(first)return "Possible: "+[str(first.key??first.tonic,""),str(first.mode,"")].filter(Boolean).join(" ");
 return "Not determined";
}
export function buildCoverTempoLabel(data:ReportV2Data,input:AuditReportInput):string {
 const audio=rec(input.sonicDna),rhythm=rec(audio.rhythmFeatures),verdict=rec(rhythm.tempoVerdict);
 if(data.tempo.value!==null)return data.tempo.value+" BPM · CONFIRMED";
 const candidate=finite(verdict.primary_candidate_bpm)?verdict.primary_candidate_bpm:null;
 if(candidate!==null&&verdict.confirmation_status!=="UNDETERMINED")return candidate+" BPM · CANDIDATE";
 return "Not determined";
}
export function metricBlock(data:ReportV2Data,input:AuditReportInput):Block[]{
 const provenance="Measured from the uploaded recording",audio=rec(input.sonicDna),rhythm=rec(audio.rhythmFeatures),verdict=rec(rhythm.tempoVerdict);
 const candidate=finite(audio.tempoCandidateBpm)?audio.tempoCandidateBpm:finite(verdict.primary_candidate_bpm)?verdict.primary_candidate_bpm:finite(audio.bpm)?audio.bpm:null;
 const tempoStatus=data.tempo.value!==null?"CONFIRMED":candidate!==null&&candidate>=40&&candidate<=220?"CANDIDATE":"NOT ANALYSED";
 const tempoDisplay=data.tempo.value!==null?data.tempo.value+" BPM · CONFIRMED":tempoStatus==="CANDIDATE"?candidate!.toFixed(1)+" BPM · CANDIDATE":"Not analysed";
 const resolution=rec(data.tonalResolution??input.tonalResolution??rec(audio.harmonicFeatures).tonalResolution??audio.tonalResolution);
 const keyBase=buildCoverKeyLabel(input,data).replace(/^Confirmed:\s*/i,"").replace(/^Possible:\s*/i,"");
 const keyStatus=resolution.status==="CONFIRMED"||data.key.value!==null?"CONFIRMED":hasReportableKeyCandidates({...audio,tonalResolution:resolution})?"CANDIDATE":"NOT ANALYSED";
 const keyDisplay=keyStatus==="CONFIRMED"?"Confirmed: "+keyBase:keyStatus==="CANDIDATE"?"Possible: "+keyBase:"Not analysed";
 const signed=(value:unknown)=>finite(value)?(value>0?"+":"")+value.toFixed(1):null;
 const lufs=finite(audio.loudnessLufs)?signed(audio.loudnessLufs)+" LUFS":"NOT ANALYSED";
 const sub=[
  finite(audio.truePeakDbfs)?"True peak "+signed(audio.truePeakDbfs)+" dBFS":null,
  finite(audio.rmsLevelDbfs)?"RMS "+signed(audio.rmsLevelDbfs)+" dBFS":null,
  finite(audio.loudnessRangeLu)?"LRA "+audio.loudnessRangeLu.toFixed(1)+" LU":null
 ].filter((value):value is string=>Boolean(value));
 const loudness=[lufs,...sub].join(" · ");
 return [
  {label:"TEMPO",value:tempoDisplay,confidence:tempoStatus,provenance},
  {label:"SONG KEY",value:keyDisplay,confidence:keyStatus,provenance},
  {label:"LOUDNESS / SIGNAL",value:loudness,provenance}
 ];
}
export function buildProposedArrangement(input:AuditReportInput,chartSeries?:TimedPoint[]|null):{summary:string;segments:ProposedArrangementSegment[]}{
 const evidence=rec(input.evidence),assessment=rec(input.assessment),position=rec(assessment.aAndRPositioning),audio=rec(input.sonicDna);
 const lane=str(evidence.genre,str(position.primaryLane,"genre lane to validate"));
 const genre=lane.toLowerCase();
 const afro=/(afrobeat|afropop|afro.?r&b|afro.?fusion)/.test(genre);
 const rap=/(hip.?hop|rap|drill|trap)/.test(genre);
 const labels=afro?["Intro / hook tease","Verse 1","Pre-hook lift","Hook / chorus","Verse 2","Hook reprise","Bridge / breakdown","Final hook","Outro"]:rap?["Intro / motif","Verse 1","Hook","Verse 2","Hook reprise","Bridge / beat variation","Final hook","Outro"]:["Intro","Verse 1","Pre-chorus","Chorus","Verse 2","Chorus reprise","Bridge / breakdown","Final chorus","Outro"];
 const weights=rap?[7,19,13,18,18,10,10,5]:[7,17,9,16,16,13,9,9,4];
 const levels=rap?[.22,.48,.78,.88,.52,.82,.45,1]:[.2,.42,.62,.88,.48,.82,.38,1,.2];
 const emotions=["Set the scene","Establish identity","Build anticipation","Release and memorability","Renew momentum","Reinforce the hook","Contrast and emotional turn","Peak resolution","Intentional tail"];
 const total=weights.reduce((sum,value)=>sum+value,0);let cursor=0;
 const duration=finite(audio.durationSeconds)&&audio.durationSeconds>0?audio.durationSeconds:null;
 const energySeries:TimedPoint[]=chartSeries!==undefined?(chartSeries??[]):arr(audio.energyOverTime??audio.energySeries).map(value=>rec(value)).filter(item=>finite(item.timeSeconds??item.time)&&finite(item.value??item.energy??item.loudness)).map(item=>({timeSeconds:Number(item.timeSeconds??item.time),value:Number(item.value??item.energy??item.loudness)}));
 let energyMin=Infinity,energyMax=-Infinity;
 for(const point of energySeries){if(point.value<energyMin)energyMin=point.value;if(point.value>energyMax)energyMax=point.value;}
 if(!Number.isFinite(energyMin)||!Number.isFinite(energyMax)){energyMin=0;energyMax=0;}
 const hasMasterAudio=hasSubmittedMasterAudio(evidence,audio);
 const vocal=rec(input.vocalAndSectionPageData??audio.vocalArrangementAnalysis),intervals=hasMasterAudio?arr(vocal.vocalActivityIntervals).slice(0,64).map(value=>rec(value)).filter(item=>finite(item.startSeconds)&&finite(item.endSeconds)&&item.endSeconds>item.startSeconds):[];
 const tonal=rec(input.tonalResolution??audio.tonalResolution??rec(audio.harmonicFeatures).tonalResolution);
 const mode=tonal.mode==="major"||tonal.mode==="minor"?String(tonal.mode):"";
 const emotionalFrame=mode==="minor"?"tension-to-release":mode==="major"?"bright lift-to-release":"contrast-to-payoff";
 const segments=labels.map((label,index)=>{
  const startPct=cursor;cursor+=weights[index]!/total*100;const endPct=cursor,centerPct=(startPct+endPct)/2;
  const time=duration===null?null:duration*centerPct/100;
  const nearest=time===null?null:energySeries.reduce((best,item)=>Math.abs(item.timeSeconds-time)<(best===null?Infinity:Math.abs(best.timeSeconds-time))?item:best,null as TimedPoint|null);
  const rawEnergy=nearest?nearest.value:null;
  const energyLevel=rawEnergy===null||energyMax===energyMin?null:.25+.75*(rawEnergy-energyMin)/(energyMax-energyMin);
  const segmentStart=duration===null?null:duration*startPct/100,segmentEnd=duration===null?null:duration*endPct/100;
  const hasVocalCue=segmentStart!==null&&segmentEnd!==null&&intervals.some(item=>Number(item.startSeconds)<segmentEnd&&Number(item.endSeconds)>segmentStart);
  const baseline=levels[index]??.5;
  const intensity=Math.max(.15,Math.min(1,energyLevel===null?baseline:baseline*.65+energyLevel*.35+((hasVocalCue ? 0.04 : 0))));
  const emotion=hasVocalCue?"Vocal-led "+emotions[index]!.toLowerCase():emotions[index]??"Dynamic progression";
  return {label,startPct,endPct,intensity,emotion};
 });
 const tempo=isReliableTempo(audio)?String(audio.bpm)+" BPM · CONFIRMED":"tempo unconfirmed";
 const keyAudio={...audio,tonalResolution:input.tonalResolution??audio.tonalResolution??rec(audio.harmonicFeatures).tonalResolution};
 const key=isReliableKey(keyAudio)?String(audio.key)+" "+String(audio.mode)+" · CONFIRMED":"tonal centre unconfirmed";
 const presence=hasMasterAudio&&finite(vocal.vocalPresencePct)?vocal.vocalPresencePct:null;
 const mood=arr(audio.moodTags).map(value=>str(value,"")).filter(Boolean).slice(0,2);
 const cue=intervals.length?"Use "+intervals.length+" signal-derived vocal activity interval(s) to place human-reviewed lyrical entries and hook focus.":presence===null?"Place lead-vocal entry and hook through human listening.":"Use "+presence.toFixed(1)+"% signal-derived vocal-band activity as a cue, then human-confirm lead-vocal and hook placement.";
 const energyCue=energySeries.length?"Section intensity is blended with the supplied relative energy envelope.":"The intensity arc is a proposed creative contour because no timestamped energy series was supplied.";
 const moodCue=mood.length?"Mood context to validate by listening: "+mood.join(", ")+".":"Mood remains a human-listening decision.";
 return {summary:"PROPOSED · "+lane+" arrangement. Context: "+tempo+"; "+key+"; "+(mode?mode+"-mode "+emotionalFrame:emotionalFrame)+". Build from a concise identity-setting opening into a clear verse-to-hook lift, create contrast before the final payoff, and retain an intentional outro. "+cue+" "+energyCue+" "+moodCue+" Creative guidance only; sections and emotional framing are proposals, not claims about the existing master.",segments};
}
function drawProposedArrangementBar(page:PDFPage,top:number,segments:ProposedArrangementSegment[],fonts:Fonts):number{
 const x=M+12,width=W-2*M-24,barY=top-22,barH=18;
 page.drawText("PROPOSED TRACK FLOW · NORMALIZED TIMELINE",{x,y:top-9,size:6.3,font:fonts.bold,color:C.muted});
 segments.forEach(segment=>{const sx=x+width*segment.startPct/100,sw=width*(segment.endPct-segment.startPct)/100,shade=Math.max(.25,Math.min(.95,segment.intensity));draw3DSolidBar(page,sx,barY,Math.max(1,sw),barH,rgb(.12+.35*shade,.34+.32*shade,.34+.2*shade));});
 const labelY=barY-11;
 segments.forEach(segment=>{const sx=x+width*segment.startPct/100,sw=width*(segment.endPct-segment.startPct)/100;if(sw>31)drawWrapped(page,segment.label,sx+1,labelY,sw-2,fonts.bold,5.1,C.ink,5.6);});
 const arcY=barY-29,points=segments.map(segment=>({x:x+width*(segment.startPct+segment.endPct)/200,y:arcY-10*segment.intensity}));
 for(let i=0;i<points.length-1;i++)page.drawLine({start:points[i]!,end:points[i+1]!,color:C.coral,thickness:1.5});
 points.forEach(point=>draw3DSolidSphere(page,point.x,point.y,2.2,C.coral));
 page.drawText("Intensity / emotional arc",{x,y:arcY-18,size:5.7,font:fonts.italic,color:C.muted});
 drawWrapped(page,"Emotional progression: "+segments.map(segment=>segment.emotion).join(" > "),x,arcY-27,width,fonts.italic,5.2,C.muted,6);
 return 88;
}
export function buildConfirmedAudioEvidenceLines(data:ReportV2Data):string[]{
 return [
  ...(data.tempo.value!==null?["TEMPO INFERENCE · CONFIRMED — weighted voting, window agreement, prominence and runner-up margin passed; "+data.tempo.value+" BPM informs the tempo and rhythmic-consistency scorecard dimensions. Tempo-to-lane fit remains unscored when no source-backed lane range exists."]:[]),
  ...(data.key.value!==null?["TONAL INFERENCE · CONFIRMED — the tonal resolver passed its window/bootstrap consensus and runner-up margin; "+String(data.key.value)+" informs the tonal-consensus scorecard dimension. This is signal-consensus evidence, not a rating of artistic harmonic quality."]:[])
 ];
}
function scoreChip(page:PDFPage,x:number,y:number,width:number,label:string,value:string,color:typeof C.teal,fonts:Fonts){
 page.drawRectangle({x,y,width,height:48,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawCircle({x:x+13,y:y+31,size:3.5,color});
 page.drawText(label.toUpperCase(),{x:x+24,y:y+28,size:6.5,font:fonts.bold,color:C.label});
 drawWrapped(page,value,x+12,y+15,width-24,fonts.bold,8.2,color,10);
}
function card(page:PDFPage,x:number,top:number,width:number,title:string,body:string[],fonts:Fonts,opts:{accent?:typeof C.teal;height?:number;provenance?:string;compact?:boolean}={}):number{
 const compact=opts.compact===true,pad=compact?8:12,titleH=compact?11:14,bodyFont=compact?7.3:8.4,bodyLine=compact?9:11,bodyGap=compact?3:5,provenanceFont=compact?6.2:7,provenanceLine=compact?7.5:9,titleFont=compact?6.4:7;
 const bodyW=width-pad*2;
 const chunks=body.map(t=>wrap(t,fonts.regular,bodyFont,bodyW));
 const bodyHeight=chunks.reduce((n,lines)=>n+lines.length*bodyLine+bodyGap,0);
 const provenance=opts.provenance?wrap(opts.provenance,fonts.italic,provenanceFont,bodyW):[];
 const height=Math.max(opts.height??0,pad+titleH+bodyHeight+(provenance.length?provenance.length*provenanceLine+4:0)+pad);
 const y=top-height;
 page.drawRectangle({x,y,width,height,color:C.white,borderColor:C.line,borderWidth:.65});
 page.drawRectangle({x,y:y+height-3,width,height:3,color:opts.accent??C.gold});
 page.drawText(title.toUpperCase(),{x:x+pad,y:top-pad-(compact?7:8),size:titleFont,font:fonts.bold,color:opts.accent??C.gold});
 let cy=top-pad-titleH-4;
 for(const lines of chunks){for(const line of lines){page.drawText(line,{x:x+pad,y:cy,size:bodyFont,font:fonts.regular,color:C.ink});cy-=bodyLine;}cy-=bodyGap;}
 for(const line of provenance){page.drawText(line,{x:x+pad,y:cy,size:provenanceFont,font:fonts.italic,color:C.muted});cy-=provenanceLine;}
 return height;
}
function drawFooter(page:PDFPage,title:string,auditId:string,n:number,total:number,fonts:Fonts){
 page.drawLine({start:{x:M,y:42},end:{x:W-M,y:42},color:C.line,thickness:.7});
 page.drawText(title.slice(0,42),{x:M,y:27,size:6.5,font:fonts.regular,color:C.muted});
 page.drawText("AUDIT "+auditId.slice(0,22),{x:W-M-170,y:27,size:6.5,font:fonts.regular,color:C.muted});
 page.drawText("PAGE "+n+" OF "+total,{x:W-M-52,y:27,size:6.5,font:fonts.bold,color:C.ink});
}
function header(page:PDFPage,title:string,fonts:Fonts){
 page.drawRectangle({x:0,y:H-66,width:W,height:66,color:C.charcoal});
 page.drawText("RESON8  /  A&R INTELLIGENCE",{x:M,y:H-26,size:7,font:fonts.bold,color:C.white});
 page.drawText(title.toUpperCase(),{x:M,y:H-48,size:13,font:fonts.bold,color:C.white});
 page.drawRectangle({x:M,y:H-70,width:W-2*M,height:3,color:C.gold});
}
function pageBase(pdf:PDFDocument,title:string,fonts:Fonts):PDFPage{
 const p=pdf.addPage([W,H]);p.drawRectangle({x:0,y:0,width:W,height:H,color:C.paper});header(p,title,fonts);return p;
}
function detectorNumber(value: unknown, digits = 3): string | null {
 return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : null;
}
export function buildTempoDiagnosticLines(input: AuditReportInput): string[] {
 const audio=rec(input.sonicDna),rhythm=rec(audio.rhythmFeatures);
 const lines:string[]=[];
 const verdict=rec(rhythm.tempoVerdict);
 const verdictConfirmed=verdict.confirmation_status==="CONFIRMED";
 const zeroProminence=!verdictConfirmed&&((finite(audio.tempoConfidence)&&audio.tempoConfidence<=0)||(finite(verdict.prominence_score)&&verdict.prominence_score<=0));
 const candidate=zeroProminence?null:
  verdictConfirmed&&finite(verdict.primary_candidate_bpm)?verdict.primary_candidate_bpm:
  finite(rhythm.tempoCandidateBpm)?rhythm.tempoCandidateBpm:
  finite(audio.tempoCandidateBpm)?audio.tempoCandidateBpm:
  finite(audio.bpm)?audio.bpm:null;
 const confirmed=candidate!==null&&(verdictConfirmed||isReliableTempo(audio));
 const alternatives=zeroProminence?[]:arr(verdict.octave_alternatives).filter(finite).filter(value=>value>=40&&value<=220);
 const candidates=zeroProminence?[]:arr(rhythm.candidateScores??audio.candidateScores).map(value=>rec(value))
  .filter(item=>finite(item.bpm)&&item.bpm>=40&&item.bpm<=220)
  .slice(0,4).map(item=>String(item.bpm)+" BPM");
 if(confirmed)lines.push("Confirmed tempo: "+candidate+" BPM.");
 else if(candidate!==null)lines.push("Tempo candidate: "+candidate+" BPM; not confirmed.");
 if(!confirmed&&candidates.length)lines.push("Possible tempo readings: "+candidates.join("; ")+". Treat these as provisional until confirmed by listening.");
 else if(!confirmed&&candidate!==null)lines.push("Possible tempo readings: "+candidate+" BPM. Treat this as provisional until confirmed by listening.");
 if(alternatives.length)lines.push("Supported half/double-time alternatives: "+alternatives.join(" / ")+" BPM.");
 const alternate= rhythm.alternateTempo??audio.alternateTempo;
 if(!zeroProminence&&alternatives.length===0&&finite(alternate)&&alternate>=40&&alternate<=220)
  lines.push("Alternative pulse reading: "+alternate.toFixed(1)+" BPM.");
 if(!confirmed&&typeof verdict.explanation==="string"&&verdict.explanation.trim())lines.push("Tempo confirmation reason: "+verdict.explanation);
 const consensus=rec(rhythm.windowConsensus??audio.windowConsensus);
 if(finite(consensus.observedAgreement))lines.push(consensus.observedAgreement>=0.7
  ?"Tempo readings are broadly consistent across the analyzed sections."
  :"Tempo readings vary across the analyzed sections; no single tempo is confirmed.");
 if(arr(rhythm.beatTimesSeconds??audio.beatTimesSeconds).length)lines.push("A tentative beat guide is available; confirm the beat placement by listening.");
 const abstention=str(rhythm.abstentionReason??audio.abstentionReason,"");
 if(!confirmed&&abstention&&abstention!=="Not supplied")lines.push("Tempo not confirmed: "+abstention);
 return lines.length?lines:["No tempo result is available from the supplied recording."];
}
export function buildKeyDiagnosticLines(input: AuditReportInput): string[] {
 const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
 const resolution=rec(input.tonalResolution??harmonic.tonalResolution??rec(input.sonicDna).tonalResolution); const tonalAudio={...rec(input.sonicDna),tonalResolution:resolution};
 const lines:string[]=[];
 const rawCandidates=arr(resolution.candidates).length?arr(resolution.candidates):arr(harmonic.topCandidates);
 const candidates=(hasReportableKeyCandidates(tonalAudio)?rawCandidates:[]).map(value=>rec(value))
  .filter(item=>typeof (item.key??item.tonic)==="string").slice(0,4)
  .map(item=>[str(item.key??item.tonic,""),str(item.mode,"")].filter(Boolean).join(" "));
 if(resolution.status==="CONFIRMED")lines.push("Confirmed audio-derived tonal centre: "+str(resolution.tonic,"")+" "+str(resolution.mode,"")+".");
 else if(resolution.status==="PROVISIONAL")lines.push("Provisional audio-derived tonal centre: "+str(resolution.tonic,"")+" "+str(resolution.mode,"")+". It is not presented as confirmed.");
 else if(resolution.status==="UNAVAILABLE")lines.push("Tonal centre unavailable: stable harmonic evidence was insufficient.");
 if(candidates.length)lines.push("Possible song keys: "+candidates.join("; ")+".");
 if(harmonic.independentEstimatorDisagrees===true)lines.push("Different key readings were returned; no single key is confirmed.");
 if(harmonic.relativeMajorMinorAmbiguity===true)lines.push("The leading candidates form a relative major/minor pair; no single key is asserted.");
 if(finite(resolution.windowAgreement))lines.push("Window agreement: "+(resolution.windowAgreement*100).toFixed(0)+"%.");
 if(finite(resolution.bootstrapShare))lines.push("Bootstrap rank share (not a calibrated probability): "+(resolution.bootstrapShare*100).toFixed(0)+"%.");

 if(finite(resolution.downbeatAnchorWindowCount))lines.push("Bass-root anchors: "+resolution.downbeatAnchorWindowCount+"/"+str(resolution.validWindowCount, "0")+" windows.");
 if(finite(resolution.cadenceWeightedWindowCount)&&resolution.cadenceWeightedWindowCount>0)lines.push("Outro weighting: "+resolution.cadenceWeightedWindowCount+" window(s).");
 const reasonCodes=arr(resolution.reasonCodes).filter((code):code is string=>typeof code==="string");
 const reasonText=reasonCodes.map(code=>({
  RELATIVE_MAJOR_MINOR_AMBIGUITY:"Relative major/minor ambiguity remains.",
  LOW_WINDOW_CONSENSUS:"Tonal windows do not consistently support one candidate.",
  LOW_BOOTSTRAP_CONSENSUS:"Bootstrap candidate ranking is unstable.",
  LOW_RUNNER_UP_MARGIN:"The top candidate is too close to its runner-up.",
  ADJACENT_FIFTHS_AMBIGUITY:"Adjacent fifth-related candidates remain close.",
  INSUFFICIENT_TONAL_EVIDENCE:"Insufficient stable tonal evidence."
 } as Record<string,string>)[code]??"A tonal disambiguation check remains unresolved.").join(" ");
 if(reasonText)lines.push(reasonText);
 if(harmonic.independentEstimatorDisagrees===true)lines.push("A secondary audio estimator disagreed; that disagreement is retained as a diagnostic and does not independently erase the primary candidate.");
 const limitation=str(harmonic.limitation,"");
 if(limitation&&limitation!=="Not supplied")lines.push("Resolution note: "+limitation);
 return lines.length?lines:["No song-key result is available from the supplied recording."];
}

export function buildEvidenceLedgerSummary(labels: Array<{ label: string }>): string {
 const counts = countEvidenceLayers(labels);
 return "Measured: " + counts.OBSERVED
  + " · Music platform records: " + counts.RECOGNIZED
  + " · Verified matches: " + counts.RECONCILED
  + " · Suggested directions: " + counts.INFERRED;
}

export function buildNextActionLine(input: AuditReportInput): string {
 const assessment=sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),rec(input.evidence)), recommendation=str(rec(assessment.releaseStrategy).recommendation,"");
 const firstGap=arr(assessment.evidenceGaps).map(value=>str(value,"")).find(value=>value&&!/^(?:not supplied|not provided|not available)$/i.test(value))??"";
 const usableRecommendation=/^(?:not supplied|not provided|not available)$/i.test(recommendation)?"":recommendation;
 return "Recommended next step: "+(usableRecommendation||firstGap||"Confirm the recording identifier and release-version mapping, complete rights and master-clearance checks, then run a measured post-release curator and creator reactivation.");
}

function buildArIntelligence(input: AuditReportInput) {
 const evidence=rec(input.evidence);
 const status=metadataFieldStatus(evidence,"releaseDate");
 const source=metadataFieldSource(evidence,"releaseDate").replace("Field source: ","");
 const attributed=source!=="unavailable"&&(status.startsWith("Cross-checked")||status.startsWith("Available")||status.startsWith("Returned")||Boolean(rec(evidence.fieldProvenance).releaseDate));
 const enrichedEvidence={...evidence,fieldProvenance:{...rec(evidence.fieldProvenance),releaseDate:attributed?source:""}};
 return buildReconciledArIntelligence({evidence:enrichedEvidence,sonicDna:rec(input.sonicDna),assessment:rec(input.assessment),generatedAt:input.generatedAt});
}
export function buildReleaseDateStatus(input: AuditReportInput): { verdict: "DETERMINED" | "UNVERIFIED"; context: "POST-RELEASE" | "UPCOMING" | "RELEASE DATE NOT RECONCILED"; date: string; source: string } {
 return buildArIntelligence(input).releaseDate;
}
export function buildReleaseFramingLine(input: AuditReportInput): string {
 const status=buildReleaseDateStatus(input);
 return status.verdict==="DETERMINED"
  ? "Release date verdict: DETERMINED — "+status.date+" · "+status.source+" · "+status.context+". Campaign guidance is framed as post-release."
  : "Release date is not source-reconciled; campaign timing must be confirmed before scheduling.";
}
export function buildDays6190Plan(input: AuditReportInput): string {
 const release=buildReleaseDateStatus(input);
 const anchor=release.verdict==="DETERMINED"?"the determined "+release.date+" release":"the confirmed release date once reconciled";
 return "Post-release catalog momentum, anchored to "+anchor+": review the prior release window and current catalog identity without assuming performance outcomes; refresh the curator and DSP pitch pack, then follow up only with contacts who accepted or requested material; expand approved creator/UGC excerpts and visual treatments around human-verified hook windows; lock artist, title, version, ISRC, UPC, EP-versus-album mapping, rights splits and master ownership against distributor and provider records; complete the day-90 performance review by comparing source-attributed platform reports and campaign activity with the pre-review baseline, documenting unavailable metrics rather than estimating streams, revenue, reach or conversion.";
}
export function buildArrangementGuidanceSummary(input:AuditReportInput):string{
 const signal=buildArIntelligence(input).vocalCadence,parts:string[]=[];
 if(signal.vocalPresencePct!==null)parts.push("Vocal-band activity proxy: "+signal.vocalPresencePct.toFixed(1)+"% of analysis windows.");
 if(signal.vocalMedianF0Hz!==null&&signal.vocalF0RangeHz)parts.push("F0 candidates: median "+signal.vocalMedianF0Hz.toFixed(1)+" Hz; 10th–90th percentile "+signal.vocalF0RangeHz.p10.toFixed(1)+"–"+signal.vocalF0RangeHz.p90.toFixed(1)+" Hz.");
 if(signal.vocalActivityIntervals.length)parts.push("Timestamped active intervals ("+signal.vocalActivityIntervals.length+"): "+signal.vocalActivityIntervals.slice(0,2).map(item=>formatSnapshotTime(item.startSeconds)+"–"+formatSnapshotTime(item.endSeconds)).join(", ")+(signal.vocalActivityIntervals.length>2?" and "+(signal.vocalActivityIntervals.length-2)+" more":"")+".");
 if(signal.inferredSections.length)parts.push("Provisional sections ("+signal.inferredSections.length+"): "+signal.inferredSections.slice(0,3).map(item=>item.label+" "+formatSnapshotTime(item.startSeconds)).join("; ")+(signal.inferredSections.length>3?"; final "+signal.inferredSections[signal.inferredSections.length-1]!.label+" "+formatSnapshotTime(signal.inferredSections[signal.inferredSections.length-1]!.startSeconds):"")+".");
 if(signal.detectedTransitions.length)parts.push("Detected transitions ("+signal.detectedTransitions.length+"): "+signal.detectedTransitions.slice(0,3).map(item=>item.id+" "+formatSnapshotTime(item.timestampSeconds)+" "+item.reason).join("; ")+".");
 return parts.length?parts.join(" "):"Vocal-band activity, F0 and structural boundaries were not analysed or could not be determined from the available PCM.";
}
function buildDerivedListeningChecks(input:AuditReportInput):string[]{
 const signal=buildArIntelligence(input).vocalCadence,checks:string[]=[];
 if(signal.vocalActivityIntervals.length){
  const intervals=signal.vocalActivityIntervals.slice(0,3).map(item=>formatSnapshotTime(item.startSeconds)+"–"+formatSnapshotTime(item.endSeconds)).join(", ");
  checks.push("Listen to signal-active intervals "+intervals+" and decide whether each contains a human vocal or an instrument; verify the F0 candidate range.");
 }else checks.push("No vocal-band activity interval was detected; listen across the full master before assigning a vocal label.");
 if(signal.detectedTransitions.length){
  const transitions=signal.detectedTransitions.slice(0,4).map(item=>item.id+" "+formatSnapshotTime(item.timestampSeconds)+" "+item.fromLabel+" to "+item.toLabel+" ("+item.reason+")").join("; ");
  checks.push("Review transition markers "+transitions+" and confirm, revise or reject each provisional section label.");
 }else checks.push("No discrete structural transition crossed the provisional thresholds; confirm the arrangement arc by listening.");
 if(signal.vocalMedianF0Hz!==null)checks.push("Check whether the median "+signal.vocalMedianF0Hz.toFixed(1)+" Hz F0 candidate is a vocal fundamental or an instrumental harmonic.");
 return checks;
}
export function buildExecutiveSummary(input:AuditReportInput,data:ReportV2Data=adaptReportV2(input)):string{
 const evidence=rec(input.evidence),assessment=sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),evidence);
 const supplied=str(assessment.executiveSummary,"");
 const release=buildReleaseDateStatus(input);
 const releaseClause=release.verdict==="DETERMINED"
  ?"Release date DETERMINED: "+release.date+" ("+release.source+"); this is a post-release catalogue and reactivation opportunity."
  :"Release-date reconciliation remains a diligence item; timing is not assumed.";
 const signalClause="Signal-derived vocal/arrangement observations: "+buildArrangementGuidanceSummary(input)+" These are inferred from the mixed uploaded master and are not confirmation of human vocals or exact section labels.";
 if(supplied&&!/not supplied|not provided|not available|insufficient evidence/i.test(supplied))
  return releaseClause+" "+supplied+" "+signalClause;
 const artist=str(evidence.artist,"the submitting artist"),title=str(evidence.title,"the submitted recording"),album=str(evidence.album,"");
 const genre=str(evidence.genre,"");
 const audioDetails=[
  data.tempo.value!==null?"measured tempo "+data.tempo.value+" BPM":null,
  data.key.value!==null?"audio-derived key "+data.key.value:null,
  typeof rec(input.sonicDna).loudnessLufs==="number"?"integrated loudness "+Number(rec(input.sonicDna).loudnessLufs).toFixed(1)+" LUFS":null
 ].filter((value):value is string=>Boolean(value));
 return "This A&R review of "+artist+"'s "+title+(album?" from "+album:"")+" combines the supplied recording analysis with source-returned catalogue identity. "+releaseClause+" "+(genre?"The provider-returned genre context is "+genre+". ":"")+"Available audio observations include "+(audioDetails.join(", ")||"the recording descriptors available in this audit")+". "+signalClause+" The market position is a PROPOSED strategic thesis, not a claim of verified audience demand or commercial performance.";
}
export function buildReportSectionTitles(input:AuditReportInput,tier:AuditReportTier="sample"):string[]{
 return buildReportSections(input,adaptReportV2(input),tier).map(page=>page.title);
}

export function buildPlaylistProviderStatusLines(input: AuditReportInput): string[] {
 const discovery=rec(rec(input.evidence).playlistDiscovery);
 const outcomes=arr(discovery.outcomes).map(value=>rec(value));
 if(!outcomes.length) {
  return ["Playlist discovery not run: no normalized ISRC or persisted provider outcome was available; no playlist target is asserted."];
 }
 return outcomes.flatMap(outcome=>{
  const provider=outcome.provider==="spotify"?"Spotify":outcome.provider==="apple_music"?"Apple Music":str(outcome.provider,"DSP provider");
  const status=str(outcome.status,"unavailable");
  const reason=str(outcome.reason,"No provider reason was persisted.");
  if(status==="not_configured"||status==="unavailable") {
   return [provider+" playlist search unavailable: "+reason+" The platform connection needs attention."];
  }
  if(status==="partial")return [provider+" provider partially available: "+reason];
  return [];
 });
}

export function buildMandatoryArAnswerLines(input: AuditReportInput): string[] {
 const intelligence = buildArIntelligence(input);
 const labels = [
  "1. Sonic/groove identity: ", "2. Hook/arrangement arc: ", "3. Mix/master readiness: ",
  "4. Primary/adjacent lanes: ", "5. Audience/territories: ", "6. Catalogue/release status: ",
  "7. Marketing/rollout: ", "8. Next decision trigger: "
 ];
 return intelligence.answers.map((item,index) => {
  const answer=item.answer.replace(/\\s+/g," ").trim();
  const limit=index===5?92:86;
  const compact=answer.length>limit?answer.slice(0,limit-3).trimEnd()+"...":answer;
  return (labels[index]??item.question+" ")+compact;
 });
}
export function buildVocalCadenceSummaryLine(input: AuditReportInput): string {
 const signal=buildArIntelligence(input).vocalCadence,findings=signal.findings;
 const primary=findings.find(line=>/^Vocal-band activity proxy:/.test(line))
  ??findings.find(line=>/^F0 candidates:/.test(line))
  ??findings.find(line=>!/^HEURISTIC_SIGNAL_DERIVED/.test(line))
  ??"Signal descriptors are not determined.";
 const intervals=signal.vocalActivityIntervals.slice(0,2).map(item=>formatSnapshotTime(item.startSeconds)+"–"+formatSnapshotTime(item.endSeconds));
 const transitions=signal.detectedTransitions.slice(0,3).map(item=>item.id+" "+formatSnapshotTime(item.timestampSeconds));
 return "Signal-derived vocal/cadence proxy: "+primary+(intervals.length?" Active intervals: "+intervals.join(", ")+".":"")+(transitions.length?" Transitions: "+transitions.join(", ")+".":"")+" [HEURISTIC_SIGNAL_DERIVED; not proof of human vocals].";
}
export function buildSwotSmartLines(input: AuditReportInput): string[] {
 const intelligence = buildReconciledArIntelligence({
  evidence: rec(input.evidence), sonicDna: rec(input.sonicDna),
  assessment: rec(input.assessment), generatedAt: input.generatedAt
 });
 const compact = (value: string, max = 68) => value.length > max ? value.slice(0, max - 3).trimEnd() + "..." : value;
 const swot = intelligence.swot.map(group =>
  group.category.toUpperCase() + ": " + group.items.map(item => compact(item, 112)).join(" ")
 );
 const smart = intelligence.smartActions.map(action =>
  action.window + " — Specific: " + compact(action.specific, 54)
  + " Measurable: " + compact(action.measurable, 54)
  + " Achievable: " + compact(action.achievable, 38)
  + " Relevant: " + compact(action.relevant, 38)
  + " Time-bound: " + compact(action.timeBound, 38)
 );
 return [...swot, ...smart];
}
export function buildCommercialStrategyLines(input: AuditReportInput): string[] {
 const strategy=rec(input.marketPlacement?.commercialStrategy);
 if(!Object.keys(strategy).length)return [];
 const coverage=rec(input.marketPlacement?.isrcCoverage);
 const primary=rec(strategy.primaryLane);
 const adjacent=arr(strategy.adjacentLanes).map(value=>str(rec(value).label,"")).filter(Boolean);
 const kpis=arr(strategy.kpis).map(value=>rec(value));
 const readiness=arr(strategy.readinessActions).map(value=>str(value,"")).filter(Boolean);
 return [
  "Commercial thesis: PROPOSED · "+str(primary.label,"Lane not established")+"; adjacent tests: "+(adjacent.join(", ")||"not yet established")+".",
  "ISRC/catalogue coverage: "+str(coverage.status,"ISRC_UNRESOLVED")+" · "+str(coverage.catalogPresenceTier,"NO_CATALOG_MATCH")+" · platforms "+(arr(coverage.matchedPlatforms).map(v=>str(v,"")).filter(Boolean).join(", ")||"none verified")+".",
  "Release lifecycle: "+str(strategy.releaseLifecycle,"UNKNOWN")+" · release-date verdict "+str(strategy.releaseDateVerdict,"UNDETERMINED")+".",
  ...(readiness.length?["Commercial readiness: "+readiness.slice(0,2).join(" ")]:[]),
  ...(kpis.length?["Verification gates: "+kpis.slice(0,3).map(item=>str(item.metric,"Metric")+ " — "+str(item.target,"Target")).join("; ")]:[]),
 ];
}
export function buildPositioningLines(input: AuditReportInput): string[] {
 const evidence = rec(input.evidence), assessment = sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),rec(input.evidence));
 const lines: string[] = [...buildCommercialStrategyLines(input)];
 const genre = str(evidence.genre, "");
 const genreSource = str(evidence.genreSource ?? evidence.genreProvider ?? evidence.genreProvenance, "");
 if (genre) {
  lines.push(genreSource
   ? "Primary lane: " + genre + " · Provider-backed (" + genreSource + ")"
   : "Genre direction: " + genre + " · PROPOSED");
 }
 const hypotheses = arr(assessment.laneHypotheses).map(value => str(value, "")).filter(Boolean);
 const adjacent = arr(assessment.adjacentLanes).map(value => str(value, "")).filter(Boolean);
 if (hypotheses.length) lines.push("Related styles to review: " + hypotheses.join("; "));
 if (adjacent.length) lines.push("Other styles to consider: " + adjacent.join("; "));
 if (!lines.length) {
  lines.push("PROPOSED market thesis: use the reconciled recording identity and measured sonic profile to test a differentiated Afro-influenced positioning direction with specialist curators and independent partners.");
  lines.push("Validation route: verify platform genre attribution, build a source-backed comparable-recording shortlist, and test the proposition through human-reviewed curator and creator outreach.");
  lines.push("Evidence boundary: this is a strategic proposition, not proof of audience overlap, commercial reach, listener demand or campaign performance.");
 }
 const basis = str(assessment.positioningBasis ?? assessment.positioningRationale, "");
 if (basis) lines.push("Positioning basis: " + basis);
 return lines;
}

function identityStatusLabel(status:string):string{
 if(status.startsWith("Unavailable"))return "Unavailable";
 if(status.startsWith("Conflicting"))return "Conflict";
 if(status.startsWith("Cross-checked"))return "Cross-checked";
 if(status.startsWith("Read from embedded")||status.startsWith("Returned by"))return "Source-returned";
 if(status.startsWith("Analytical hypothesis"))return "Hypothesis";
 if(status.startsWith("Synthetic test"))return "Synthetic";
 if(status.startsWith("Parsed from uploaded filename"))return "Provisional";
 if(status.startsWith("Available"))return "Unconfirmed";
 return status;
}
export function buildIdentityReconciliationRows(input:AuditReportInput):Array<{field:string;value:string;status:string;source:string}>{
 const e=rec(input.evidence),reconciliation=rec(e.reconciliation);
 const conflicts=arr(reconciliation.conflicts).map(v=>rec(v));
 const releaseDifferences=arr(reconciliation.releaseContextDifferences).map(v=>rec(v));
 const fields:[string,string][]=[["artist","Artist"],["title","Track"],["album","Album"],["genre","Genre"],["releaseDate","Release date"],["isrc","Recording code"],["upc","Release code"],["label","Label"]];
 return fields.map(([key,label])=>{
  const conflict=conflicts.find(item=>item.field===key);
  const releaseDifference=releaseDifferences.find(item=>item.field===key);
  const raw=key==="genre"?(e.genre??e.genres):e[key];
  const differingValues=conflict??releaseDifference;
  const value=differingValues?arr(differingValues.values).map(v=>str(v,"")).filter(Boolean).join(" vs "):Array.isArray(raw)?raw.map(v=>str(v,"")).filter(Boolean).join(", "):str(raw,"Unavailable");
  const sourceLabel=metadataFieldSource(e,key),source=sourceLabel.replace("Field source: ","");
  const fieldStatus=metadataFieldStatus(e,key);
  const releaseDateDetermined=key==="releaseDate"&&buildReleaseDateStatus(input).verdict==="DETERMINED";
  const status=releaseDateDetermined?"DETERMINED":conflict?"Conflict":releaseDifference?"Release variant":fieldStatus.startsWith("Available")&&source!=="unavailable"?"Source-returned":identityStatusLabel(fieldStatus);
  return {field:label,value,status,source};
 });
}
function drawIdentityReconciliation(page:PDFPage,input:AuditReportInput,fonts:Fonts):number{
 const e=rec(input.evidence),rows=buildIdentityReconciliationRows(input),x=M,width=W-2*M,top=H-100,headerH=22,rowH=36;
 const columns=[78,164,128,141],labels=["FIELD","VALUE","STATUS","SOURCE"];
 page.drawRectangle({x,y:top-headerH,width,height:headerH,color:C.charcoal});
 let cx=x;
 labels.forEach((label,index)=>{page.drawText(label,{x:cx+8,y:top-15,size:6.6,font:fonts.bold,color:C.white});cx+=columns[index];});
 rows.forEach((row,index)=>{
  const rowTop=top-headerH-index*rowH,rowBottom=rowTop-rowH;
  page.drawRectangle({x,y:rowBottom,width,height:rowH,color:index%2===0?C.white:C.paper,borderColor:C.line,borderWidth:.45});
  const values=[row.field,row.value,row.status,row.source],colors=[C.ink,C.ink,row.status==="Conflict"?C.coral:row.status==="Release variant"||row.status==="Hypothesis"?C.amber:row.status==="Cross-checked"||row.status==="DETERMINED"?C.teal:row.status==="Unavailable"?C.muted:C.ink,C.muted];
  let cellX=x;
  values.forEach((value,col)=>{
   const font=col===0||col===2?fonts.bold:fonts.regular,size=col===0?7.1:col===1?7:6.7,maxLines=3,lines=wrap(value||"Not supplied",font,size,columns[col]-14);
   if(lines.length>maxLines)throw new Error("Identity reconciliation cell exceeds its row: "+row.field+" / "+labels[col]);
   lines.forEach((line,lineIndex)=>page.drawText(line,{x:cellX+8,y:rowTop-11-lineIndex*8,size,font,color:colors[col]}));
   cellX+=columns[col];
  });
 });
 const tableBottom=top-headerH-rows.length*rowH,summaryTop=tableBottom-10;
 const sourceName=(value:unknown)=>({apple_music:"Apple Music",id3:"Audio file tags",audd:"AudD",musicbrainz:"MusicBrainz",spotify:"Spotify",tidal:"TIDAL",deezer:"Deezer"} as Record<string,string>)[str(value,"").toLowerCase()]??str(value,"");
 const checked=arr(e.metadataSourcesChecked).map(sourceName).filter(Boolean).join(", ")||"Not supplied";
 const providers=arr(e.sourceProviders).map(sourceName).filter(Boolean).join(", ")||"Not supplied";
 const catalogSources=arr(e.catalogSources).map(value=>rec(value));
 const recognizedCount=catalogSources.filter(item=>item.status==="recognized").length;
 const platformCoverage=str(e.platformCoverage,"");
 const coverage=platformCoverage|| (recognizedCount>0?recognizedCount+" provider record(s) recognized; total platform coverage was not enumerated.":"No provider coverage result was recorded.");
 const summaryHeight=card(page,M,summaryTop,width,"Provider lookup and reconciliation context",[
  "Sources checked: "+checked,
  "Provider responses: "+providers,  "Platform coverage: "+coverage,
  "Recording identity conflicts remain blocking; album, UPC, label and date differences are shown as release variants."
 ],fonts,{accent:C.gold});
 return summaryTop-summaryHeight-14;
}
export function buildStrengthRiskSummary(input:AuditReportInput,assessmentOverride?:Record<string,unknown>):{strengths:string[];risks:string[];strengthCount:number;riskCount:number}{
 const assessment=assessmentOverride??rec(input.assessment);
 const clean=(value:unknown)=>arr(value).map(item=>str(item,""));
 const strengths=reconciledAssessmentItems(clean(assessment.strengths)),risks=reconciledAssessmentItems(clean(assessment.risks));
 return {strengths,risks,strengthCount:strengths.length,riskCount:risks.length};
}
export function buildReleaseCampaignLabels(input:AuditReportInput){
 const release=buildReleaseDateStatus(input),postRelease=release.verdict==="DETERMINED"&&release.context==="POST-RELEASE";
 return postRelease?{
  preRelease:"Pre-release stage (historical; already passed)",
  releaseWindow:"Release window (historical; already passed)",
  postRelease:"Post-release growth and reactivation",
  first30:"First 30 days · post-release (audit-relative)",
  days3160:"Days 31–60 · post-release (audit-relative)",
  days6190:"Days 61–90 · post-release (audit-relative)"
 }:{
  preRelease:"Pre-release",
  releaseWindow:"Release window",
  postRelease:"Post-release",
  first30:"First 30 days",
  days3160:"Days 31–60",
  days6190:"Days 61–90"
 };
}
function buildReportSections(input:AuditReportInput,data:ReportV2Data,tier:AuditReportTier):PageSpec[]{
 const e=rec(input.evidence),a=sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),rec(input.evidence)),sonic=rec(input.sonicDna);
 const notesContext=buildArNotesDecisionContext(input);
 const pages:PageSpec[]=[
  {title:"Cover and verdict",kind:"cover",blocks:metricBlock(data,input),lines:[
   "Artist: "+str(e.artist)+"   Track: "+str(e.title),
   "Audit date: "+dateText(input.generatedAt)+"   Release date: "+dateText(e.releaseDate),
   "Executive summary: "+buildExecutiveSummary(input,data),
   buildNextActionLine(input)
  ]},
  {title:"Identity and source reconciliation",kind:"identity",blocks:[]},
  {title:"Track snapshot",kind:"snapshot",blocks:metricBlock(data,input),lines:[
   ...(data.structure?["STRUCTURE — "+data.structure.map(s=>s.index+". "+s.label+" ("+s.startSeconds+"–"+s.endSeconds+"s)").join(" | ")]:[]),
   ...(data.energySeries?["ENERGY SERIES — "+(data.energySeriesPointCount??data.energySeries.length)+" timestamped source points; chart preserves extrema using "+data.energySeries.length+" plotted points."]:[]),
   ...(data.sonicAxes?["SONIC DNA AXES — "+Object.entries(data.sonicAxes).map(([name,axis])=>name+" "+axis.value+"/100"+(axis.note?" ("+axis.note+")":"")).join("; ")]:[])
  ]},
  {title:"A&R positioning",blocks:[],lines:[...buildMandatoryArAnswerLines(input),buildVocalCadenceSummaryLine(input),...buildPositioningLines(input)]},
  {title:"Strengths, risks and actions",blocks:[],lines:[
   "Strengths ("+buildStrengthRiskSummary(input).strengthCount+" documented): "+(buildStrengthRiskSummary(input).strengths.slice(0,2).map(value=>value.length>125?value.slice(0,122).trimEnd()+"...":value).join("; ")||"No measured strengths supplied.")+(buildStrengthRiskSummary(input).strengthCount>2?" · "+(buildStrengthRiskSummary(input).strengthCount-2)+" additional documented item(s).":""),
   "Risks ("+buildStrengthRiskSummary(input).riskCount+" documented): "+(buildStrengthRiskSummary(input).risks.slice(0,2).map(value=>value.length>125?value.slice(0,122).trimEnd()+"...":value).join("; ")||"No evidenced risks supplied.")+(buildStrengthRiskSummary(input).riskCount>2?" · "+(buildStrengthRiskSummary(input).riskCount-2)+" additional documented item(s).":""),

   "Priorities: "+arr(rec(a.releaseStrategy).priorities).map(v=>str(v)).join("; ")||"No priorities supplied.",
   "Readiness: "+str(a.releaseReadiness,"Pending — no supplied readiness evidence."),
   ...buildCommercialStrategyLines(input).slice(3,5),
   ...buildSwotSmartLines(input),
   ...(data.moments??[]).map(m=>"Flagged moment "+m.timestampSeconds.toFixed(2)+"s · "+m.tag+" · "+m.title+" — "+m.note)
  ]},
  {title:"Release and promotion plan",blocks:[],lines:[
   buildReleaseFramingLine(input),
   ...buildCommercialStrategyLines(input).slice(2,3),
   "General guidance: "+str(a.industryPractice,"No industry guidance supplied."),
   ...(arr(rec(a.promotionPlan).contentIdeas).map(v=>str(v,"")).filter(Boolean).length?["Content concepts: "+arr(rec(a.promotionPlan).contentIdeas).map(v=>str(v,"")).filter(Boolean).join("; ")]:[]),
   ...(arr(rec(a.promotionPlan).playlistCategories).map(v=>str(v,"")).filter(Boolean).length?["Playlist categories to investigate: "+arr(rec(a.promotionPlan).playlistCategories).map(v=>str(v,"")).filter(Boolean).join("; ")]:[]),
   ...buildPlaylistProviderStatusLines(input),
   ...(e.label||e.partner?["Supplied label / partner: "+str(e.label??e.partner)]:[])
  ]},
 ];
 if(tier==="full"){
  const promotion=rec(a.promotionPlan),partner=rec(a.labelPartnerFit),execution=rec(a.executionPlan);
  const releaseStatus=buildReleaseDateStatus(input),campaignLabels=buildReleaseCampaignLabels(input);
  const isPostRelease=releaseStatus.verdict==="DETERMINED"&&releaseStatus.context==="POST-RELEASE";
  const paragraph=(label:string,value:unknown,fallback="Not supplied in the assessment."):Block=>{
   const rendered=str(value,fallback);
   const candidate=/^(?:not supplied|not provided|not available)(?: in the assessment)?\.?$/i.test(rendered)?fallback:sanitizePublicReportLine(rendered);
   return {label,value:candidate||fallback};
  };
  const compact=(value:unknown,max=220):string=>{const clean=str(value,"");if(clean.length<=max)return clean;const shortened=clean.slice(0,max-1).replace(/\s+\S*$/,"").trimEnd();return (shortened||clean.slice(0,max-1).trimEnd())+"…";};
  const list=(label:string,value:unknown[],fallback="Not supplied in the assessment."):Block=>{
   const items=value.map(item=>sanitizePublicReportLine(str(item,""))).filter(Boolean);
   return {label,value:items.join("\n\n")||fallback};
  };
  const executionFallback=(phase:string)=>"Post-release action: "+phase+". Confirm completion with dated source records; do not substitute estimated streams, sales, revenue, audience reach or conversion for unavailable reporting.";
  const postReleasePhase=(label:string,value:unknown,fallback:string):Block=>{
   const block=paragraph(label,value,fallback);
   if(!isPostRelease)return block;
   const anchor="Post-release action relative to the audit date; original release date "+releaseStatus.date+" was determined by "+releaseStatus.source+". ";
   return {label:/post-release/i.test(label)?label:label+" · post-release (audit-relative)",value:anchor+block.value};
  };
  const historicalPhase=(label:string,value:unknown,fallback:string):Block=>{
   const block=paragraph(label,value,fallback);
   const historicalLabel=/historical; already passed/i.test(label)?label:label+" (historical; already passed)";
   return isPostRelease?{label:historicalLabel,value:"Historical context only; this is not an upcoming campaign action. "+block.value}:block;
  };
  const days90Text=str(execution.days90,"");
  const days90Plan=/not supplied|not provided|fixture timeline|not a confirmed release calendar/i.test(days90Text)?buildDays6190Plan(input):days90Text;
  // The five full-report narrative sections follow the seven core analytical pages.
  pages.push(
   {title:"Production and arrangement guidance",blocks:[
    paragraph("Production and arrangement guidance",a.productionArrangementGuidance),
    paragraph("Signal-derived vocal and arrangement observations",buildArrangementGuidanceSummary(input),"No reliable vocal or structural signal analysis was available."),
    list("Human listening checks",[...arr(a.listeningChecks).map(value=>str(value,"")).filter(Boolean),...buildDerivedListeningChecks(input)])
   ],kind:"narrative"},
   {title:"Comparable lanes and listening references",blocks:[paragraph("Comparable lane hypothesis",a.laneHypothesis),list("References to verify (not asserted matches)",arr(a.referencesToVerify)),paragraph("Verification method",a.verificationMethod),(()=>{const proposal=buildProposedArrangement(input,data.energySeries);return {label:"PROPOSED ARRANGEMENT & EMOTIONAL ARC",value:proposal.summary,arrangementBar:proposal.segments,provenance:"PROPOSED · creative arrangement guidance; human listening required"};})()],kind:"narrative"},
   {title:"Promotion and campaign strategy",blocks:[
    paragraph("ISRC-anchored catalogue coverage",compact(buildCommercialStrategyLines(input).slice(1,2).join(" "),210)),
    paragraph("Audience and short-form strategy",[
      ...arr(rec(input.marketPlacement?.commercialStrategy).audienceContexts).slice(0,1),
      ...arr(rec(input.marketPlacement?.commercialStrategy).shortFormAngles).slice(0,2).map(value=>compact(value,130)),
    ].map(value=>compact(value,130)).filter(Boolean).join(" ")),
    list("Playlist and curator pitch hooks",arr(rec(input.marketPlacement?.commercialStrategy).playlistPitchHooks).slice(0,2).map(value=>compact(value,120))),
    historicalPhase(campaignLabels.preRelease,isPostRelease?"Closed — the determined "+releaseStatus.date+" release has already passed; this is historical context, not an upcoming action.":promotion.preRelease,"No pre-release actions were supplied."),
    historicalPhase(campaignLabels.releaseWindow,isPostRelease?"Passed — focus current activity on post-release reactivation.":promotion.releaseWindow,"No release-window actions were supplied."),
    paragraph(campaignLabels.postRelease,isPostRelease?[compact(promotion.postRelease,210),"PROPOSED continuation: re-frame the human-confirmed hook; create rights-approved short-form and visual cutdowns; reconcile ISRC/UPC, version and credits; re-pitch lane-matched curators; schedule one catalyst drop; measure attributable response only."].filter(Boolean).join(" "):compact(promotion.postRelease,360),"Post-release reactivation: refresh the source-backed pitch pack, follow up with responsive curators, publish approved creator assets and record only attributable platform activity."),
    list("Content concepts",arr(promotion.contentIdeas).slice(0,3).map(value=>compact(value,100))),list("Pitching angles",arr(promotion.pitchingAngles).slice(0,3).map(value=>compact(value,100))),
    list("DSP playlist archetypes to investigate",arr(promotion.playlistCategories).slice(0,3).map(value=>compact(value,70))),paragraph("Industry practice",compact(promotion.industryPractice,260))
   ],kind:"narrative"},
   {title:"Label and partner fit",blocks:[
    paragraph("Partner profile hypothesis",partner.partnerProfile),list("Criteria to demonstrate",arr(partner.criteriaToDemonstrate)),
    paragraph("Commercial sync/partner gate",str(rec(rec(input.marketPlacement?.commercialStrategy).syncFit).rationale,"Rights, master approval and a defined partner brief must be verified.")),
    list("Commercial partner fit criteria",arr(rec(input.marketPlacement?.commercialStrategy).partnerFitCriteria).slice(0,2)),
    paragraph("Rights and submission diligence",partner.diligenceBeforeContact),paragraph("Industry practice",[
      ...arr(rec(input.marketPlacement?.commercialStrategy).industryPractice).slice(0,1).map(value=>str(value,"")),
      str(partner.industryPractice,""),
    ].filter(Boolean).join(" "))
   ],kind:"narrative"},
   {title:"30 / 60 / 90-day execution plan",blocks:[
    postReleasePhase(campaignLabels.first30,execution.days30,executionFallback("reconcile ISRC, UPC, artist/title spelling, EP-versus-album release mapping, rights splits and approved master; prepare a post-release positioning brief and verify the first curator/creator target list")),
    postReleasePhase(campaignLabels.days3160,execution.days60,executionFallback("run a controlled post-release reactivation with approved short-form excerpts, follow up on curator responses, refresh visual assets and record only source-attributed platform and campaign observations")),
    postReleasePhase(campaignLabels.days6190,days90Plan,buildDays6190Plan(input)),
    list("Commercial verification gates",arr(rec(input.marketPlacement?.commercialStrategy).kpis).slice(0,4).map(value=>{const item=rec(value);return str(item.metric,"Metric")+": "+str(item.target,"Target")+" — "+str(item.verification,"Verify with source records");}))
   ],kind:"narrative"}
  );
  // Deep-dive pages are evidence-gated; do not emit pages that contain only missing-data placeholders.
  if(data.sonicAxes) pages.push({title:"Sonic DNA dashboard",blocks:[],kind:"full-axes"});

  const assessment=rec(input.assessment),release=rec(assessment.releaseStrategy),contract=rec(input.realMasterContract);
  const timeline=Array.isArray(release.executionTimeline)?release.executionTimeline:Array.isArray(assessment.executionTimeline)?assessment.executionTimeline:[];
  const hasScore=data.headlineScore!==null||(data.scoreDrivers?.length??0)>0;
  const hasPlaybackMeasurements=["integrated_loudness_lufs","true_peak_dbfs","rms_level_dbfs"].some(key=>typeof contract[key]==="number"&&Number.isFinite(contract[key]));
  if(hasScore||timeline.length>0||hasPlaybackMeasurements)
   pages.push({title:"Scorecard, execution timeline and loudness",blocks:[],kind:"full-depth"});
 }
 pages.push({title:"A&R notes",blocks:[],lines:[
  ...arr(a.humanListeningChecklist).map(value=>str(value,"")).filter(value=>value&&!/^not supplied$/i.test(value)).map(value=>"[ ] "+value),
  notesContext.verdict,
  notesContext.summary,
  ...notesContext.prompts.map(prompt=>"Review prompt: "+prompt),
  "Record the A&R decision, owner, follow-up date and evidence still required."
 ],kind:"ar-notes"});
 return pages;
}

export function metricCardValueLayout(label:string):{fontSize:number;lineHeight:number;maxLines:number;cardHeight:number}{
 if(label.toUpperCase()==="LOUDNESS / SIGNAL")return {fontSize:7.2,lineHeight:8.5,maxLines:4,cardHeight:SNAPSHOT_METRIC_CARD_HEIGHT};
 return {fontSize:14,lineHeight:17,maxLines:2,cardHeight:SNAPSHOT_METRIC_CARD_HEIGHT};
}
function drawMetricCard(page:PDFPage,x:number,top:number,width:number,block:Block,fonts:Fonts):number{
 const pad=12,layout=metricCardValueLayout(block.label),bodyWidth=width-pad*2,height=layout.cardHeight,y=top-height;
 const isLoudness=block.label.toUpperCase()==="LOUDNESS / SIGNAL",parts=block.value.split(" · ");
 page.drawRectangle({x,y,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:y+height-3,width,height:3,color:C.gold});
 page.drawText(block.label,{x:x+pad,y:top-17,size:7,font:fonts.bold,color:C.muted});
 if(isLoudness){
  page.drawText(parts[0]??"NOT ANALYSED",{x:x+pad,y:top-48,size:12,font:fonts.bold,color:C.ink});
  parts.slice(1,4).forEach((part,index)=>{
   const col=index%2,row=Math.floor(index/2);
   drawWrapped(page,part,x+pad+col*(bodyWidth/2+2),top-66-row*11,bodyWidth/2-4,fonts.regular,5.7,C.muted,6.3);
  });
 }else{
  const valueLines=wrap(block.value,fonts.bold,block.label==="TEMPO"?14:10.5,bodyWidth).slice(0,2);
  valueLines.forEach((line,index)=>page.drawText(line,{x:x+pad,y:top-45-index*13,size:block.label==="TEMPO"?14:10.5,font:fonts.bold,color:C.ink}));
  if(block.confidence){
   const badgeWidth=fonts.bold.widthOfTextAtSize(block.confidence,5.2)+10,badgeX=x+width-pad-badgeWidth;
   const fill=block.confidence==="CONFIRMED"?C.teal:block.confidence==="CANDIDATE"?C.amber:C.paper;
   page.drawRectangle({x:badgeX,y:top-27,width:badgeWidth,height:10,color:fill,borderColor:C.line,borderWidth:.35});
   page.drawText(block.confidence,{x:badgeX+5,y:top-23.8,size:5.2,font:fonts.bold,color:block.confidence==="NOT ANALYSED"?C.muted:C.white});
  }
 }
 drawWrapped(page,block.provenance??"Measured from the uploaded recording",x+pad,top-91,bodyWidth,fonts.regular,6.3,C.muted,7);
 return height;
}
export function normalizeCircleNote(value:string):string{
 const enharmonic:Record<string,string>={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"};
 const match=value.trim().match(/^([A-G](?:#|b)?)/i);
 if(!match)return "";
 const note=match[1][0].toUpperCase()+match[1].slice(1);
 return enharmonic[note]??note;
}
function drawCircleOfFifths(page:PDFPage,input:AuditReportInput,data:ReportV2Data,fonts:Fonts,top:number):number{
 const x=M,width=W-2*M,height=SNAPSHOT_KEY_MAP_HEIGHT,bottom=top-height;
 page.drawRectangle({x,y:bottom,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:top-3,width,height:3,color:C.gold});
 page.drawText("CIRCLE OF FIFTHS · SONG KEY MAP",{x:x+12,y:top-17,size:7,font:fonts.bold,color:C.gold});
 const order=["F#","B","E","A","D","G","C","F","A#","D#","G#","C#"];
 const cx=x+93,cy=top-84,radius=48;
 const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
 const resolution=rec(input.tonalResolution??harmonic.tonalResolution??rec(input.sonicDna).tonalResolution);
 const tonalAudio={...rec(input.sonicDna),tonalResolution:resolution};
 const rawCandidates=arr(resolution.candidates).length?arr(resolution.candidates):arr(harmonic.topCandidates);
 const candidates=hasReportableKeyCandidates(tonalAudio)?rawCandidates.map(value=>rec(value)):[];
 const candidateNotes=new Set(candidates.map(item=>normalizeCircleNote(str(item.key??item.tonic,""))).filter(Boolean));
 const confirmed=data.key.value===null?"":normalizeCircleNote(String(data.key.value));
 order.forEach((note,index)=>{
  const angle=-Math.PI/2+index*2*Math.PI/12,px=cx+Math.cos(angle)*radius,py=cy+Math.sin(angle)*radius;
  const isConfirmed=Boolean(confirmed&&note===confirmed),isCandidate=!isConfirmed&&candidateNotes.has(note);
  const fill=isConfirmed?C.teal:isCandidate?C.amber:C.paper;
  draw3DSolidSphere(page,px,py,11,fill);
  const labelWidth=fonts.bold.widthOfTextAtSize(note,6.5);
  page.drawText(note,{x:px-labelWidth/2,y:py-2.2,size:6.5,font:fonts.bold,color:isConfirmed||isCandidate?C.white:C.ink});
 });
 const status=resolution.status==="PROVISIONAL"
  ?"Provisional tonal centre: "+str(resolution.tonic,"")+" "+str(resolution.mode,"")+". Highlighted notes are candidates, not a confirmed key."
  :resolution.status==="UNAVAILABLE"
   ?"Tonal centre unavailable: stable harmonic evidence was insufficient."
   :data.key.value===null
    ?"No single root key is confirmed. Highlighted notes are possible tonal centres, not a final answer."
    :"Confirmed song key: "+String(data.key.value)+".";
 drawWrapped(page,status,x+174,top-52,width-190,fonts.regular,8,C.ink,11);
 const names=candidates.slice(0,4).map(item=>[str(item.key??item.tonic,""),str(item.mode,"")].filter(Boolean).join(" ")).filter(Boolean);
 if(names.length)drawWrapped(page,"Candidates: "+names.join(" · "),x+174,top-91,width-190,fonts.bold,7,C.muted,9);
 const diagnosticLines=buildKeyDiagnosticLines(input).filter(line=>
  /^(Window agreement:|Bootstrap rank share|Runner-up margin:|Bass-root anchors:|Outro weighting:|Relative major\/minor ambiguity remains\.|Tonal windows do not consistently support one candidate\.|Bootstrap candidate ranking is unstable\.|The top candidate is too close to its runner-up\.|Adjacent Circle of Fifths candidates remain close\.)/.test(line)
 );
 const tuningWindows=Number(rec(input.sonicDna).tuningEvidenceWindows);
 if(Number.isFinite(tuningWindows)&&tuningWindows>1){
  diagnosticLines.unshift("More than one tuning window was detected; a single tuning reference is not confirmed.");
 }
 let diagnosticY=top-108;
 for(const line of diagnosticLines.slice(0,5)){
  const used=drawWrapped(page,line,x+174,diagnosticY,width-190,fonts.regular,5.8,C.muted,6.8);
  diagnosticY-=used;
 }
 return height;
}
function drawCompactSonicAxes(page:PDFPage,data:ReportV2Data,fonts:Fonts,top:number):number{
 if(!data.sonicAxes)return 0;
 const axes=Object.entries(data.sonicAxes),height=128,bottom=top-height,x=M,width=W-2*M;
 page.drawRectangle({x,y:bottom,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:top-3,width,height:3,color:C.gold});
 page.drawText("SONIC PROFILE",{x:x+12,y:top-17,size:7,font:fonts.bold,color:C.gold});
 axes.slice(0,5).forEach(([name,axis],index)=>{
  const y=top-39-index*17;
  page.drawText(name,{x:x+12,y,size:6.7,font:fonts.bold,color:C.ink});
  page.drawRectangle({x:x+145,y:y-2,width:210,height:6,color:C.line});
  draw3DSolidBar(page,x+145,y-2,210*Math.max(0,Math.min(100,axis.value))/100,6,axis.value<60?C.amber:C.teal);
  page.drawText(String(axis.value),{x:x+365,y:y-1,size:6.7,font:fonts.bold,color:C.ink});
 });
 return height;
}
function formatSnapshotTime(seconds:number):string{
 const safe=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
 return Math.floor(safe/60)+":"+String(safe%60).padStart(2,"0");
}
function drawVocalArrangementCard(page:PDFPage,top:number,fonts:Fonts,input:AuditReportInput):number{
 const audio=rec(input.sonicDna),analysis=rec(input.vocalAndSectionPageData??audio.vocalArrangementAnalysis??audio.vocalFeatures);
 const hasMasterAudio=hasSubmittedMasterAudio(rec(input.evidence),Object.keys(audio).length?audio:null);
 const sections=hasMasterAudio?arr(analysis.inferredSections).slice(0,64).map(value=>rec(value)).filter(item=>finite(item.startSeconds)&&finite(item.endSeconds)&&item.endSeconds>item.startSeconds):[];
 const transitions=hasMasterAudio?arr(analysis.detectedTransitions).slice(0,16).map(value=>rec(value)).filter(item=>finite(item.timestampSeconds)):[];
 const intervals=hasMasterAudio?arr(analysis.vocalActivityIntervals).slice(0,64).map(value=>rec(value)).filter(item=>finite(item.startSeconds)&&finite(item.endSeconds)&&item.endSeconds>item.startSeconds):[];
 const duration=finite(audio.durationSeconds)&&audio.durationSeconds>0?audio.durationSeconds:Math.max(1,...sections.map(item=>Number(item.endSeconds)));
 const presence=hasMasterAudio&&finite(analysis.vocalPresencePct)?Math.max(0,Math.min(100,analysis.vocalPresencePct)):null;
 const vocalDetected=hasMasterAudio&&analysis.vocalActivityStatus==="SIGNAL_ACTIVITY_DETECTED"&&presence!==null&&presence>0;
 const pitch=hasMasterAudio&&finite(analysis.vocalMedianF0Hz)?analysis.vocalMedianF0Hz:null;
 const range=rec(analysis.vocalF0RangeHz),low=hasMasterAudio&&finite(range.p10)?range.p10:null,high=hasMasterAudio&&finite(range.p90)?range.p90:null;
 const energy=hasMasterAudio&&finite(analysis.vocalBandEnergyDbfs)?analysis.vocalBandEnergyDbfs:null;
 const x=M,width=W-2*M,height=SNAPSHOT_VOCAL_MODULE_HEIGHT,bottom=top-height,pad=10,left=x+pad,right=x+width-pad,barWidth=right-left;
 page.drawRectangle({x,y:bottom,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:top-3,width,height:3,color:C.gold});
 page.drawText("VOCAL ANALYSIS, SECTIONS AND TRANSITIONS",{x:x+pad,y:top-16,size:7,font:fonts.bold,color:C.gold});
 const status=!hasMasterAudio?"• NOT ANALYSED · NO UPLOADED MASTER":vocalDetected?"• VOCALS DETECTED · INFERRED FROM UPLOADED MASTER SIGNAL":"• INSTRUMENTAL / LOW VOCAL ACTIVITY";
 const statusWidth=Math.min(width-185,fonts.bold.widthOfTextAtSize(status,5.1)+10);
 page.drawRectangle({x:x+pad,y:top-32,width:statusWidth,height:11,color:vocalDetected?C.amber:C.paper,borderColor:C.line,borderWidth:.35});
 page.drawText(status,{x:x+pad+5,y:top-28.5,size:5.1,font:fonts.bold,color:vocalDetected?C.white:C.muted});
 page.drawText(hasMasterAudio?"SIGNAL-DERIVED FROM UPLOADED MASTER":"MASTER SIGNAL NOT SUPPLIED",{x:right-164,y:top-28.5,size:5.2,font:fonts.bold,color:C.muted});
 const timelineTop=top-43;
 page.drawText("SONG ARRANGEMENT SECTIONS, TRANSITIONS AND VOCAL ACTIVITY",{x:left,y:timelineTop,size:5.8,font:fonts.bold,color:C.ink});
 page.drawText(hasMasterAudio?"INFERRED · PROVISIONAL LABELS":"NOT ANALYSED · MASTER NOT SUPPLIED",{x:right-142,y:timelineTop,size:5.1,font:fonts.bold,color:C.amber});
 const barY=timelineTop-30;
 const colorFor=(label:string)=>{
  const value=label.toLowerCase();
  if(/intro|outro/.test(value))return C.teal;
  if(/pre-chorus/.test(value))return C.gold;
  if(/chorus/.test(value))return C.coral;
  if(/verse/.test(value))return C.teal;
  if(/bridge/.test(value))return C.muted;
  if(/instrumental|loop|solo/.test(value))return C.muted;
  if(/breakdown|drop/.test(value))return C.amber;
  return C.label;
 };
 page.drawRectangle({x:left,y:barY,width:barWidth,height:14,color:C.paper,borderColor:C.line,borderWidth:.4});
 if(sections.length){
  sections.forEach((section,index)=>{
   const start=Math.max(0,Number(section.startSeconds)),end=Math.min(duration,Number(section.endSeconds));
   const bx=left+start/duration*barWidth,bw=Math.max(1,(end-start)/duration*barWidth);
   draw3DSolidBar(page,bx,barY,bw,14,colorFor(str(section.label,"Section")));
   if(bw>24)page.drawText(String(section.label??("Section "+(index+1))).slice(0,16),{x:bx+2,y:barY+4,size:4.7,font:fonts.bold,color:C.white});
  });
 }else page.drawText(hasMasterAudio?"Section boundaries not confidently inferred":"Not analysed — no uploaded master signal supplied",{x:left+5,y:barY+4,size:5,font:fonts.italic,color:C.muted});
 page.drawText(hasMasterAudio?"0:00":"Time unavailable",{x:left,y:barY-9,size:5.1,font:fonts.regular,color:C.muted});
 page.drawText(hasMasterAudio?formatSnapshotTime(duration):"Not analysed",{x:right-42,y:barY-9,size:5.1,font:fonts.regular,color:C.muted});
 transitions.slice(0,16).forEach((item,index)=>{
  const tx=left+Math.max(0,Math.min(duration,Number(item.timestampSeconds)))/duration*barWidth;
  page.drawLine({start:{x:tx,y:barY-1},end:{x:tx,y:barY+20},color:C.ink,thickness:.6});
  page.drawText(String(item.id??("T"+(index+1))),{x:Math.max(left,Math.min(right-12,tx-4)),y:barY+16,size:4.5,font:fonts.bold,color:C.ink});
 });
 const vocalY=barY-20;
 page.drawText("VOCAL ACTIVITY",{x:left,y:vocalY+6,size:4.9,font:fonts.bold,color:C.muted});
 page.drawRectangle({x:left+78,y:vocalY,width:barWidth-78,height:5,color:C.paper,borderColor:C.line,borderWidth:.4});
 intervals.forEach(interval=>{
  const start=Math.max(0,Number(interval.startSeconds)),end=Math.min(duration,Number(interval.endSeconds));
  if(end<=start)return;
  draw3DSolidBar(page,left+78+start/duration*(barWidth-78),vocalY,Math.max(1,(end-start)/duration*(barWidth-78)),5,C.teal);
 });
 const intervalText=!hasMasterAudio?"Not analysed — no uploaded master signal supplied.":intervals.length
  ?intervals.slice(0,5).map(item=>formatSnapshotTime(Number(item.startSeconds))+"–"+formatSnapshotTime(Number(item.endSeconds))).join(" · ")+(intervals.length>5?" · +"+(intervals.length-5)+" more":"")
  :"No active intervals · "+String(analysis.analysisReason??"Low vocal-band activity or insufficient PCM quality.").slice(0,118);
 drawWrapped(page,intervalText,left,vocalY-7,barWidth,fonts.regular,4.7,C.muted,5.3);
 const legend=[["Intro/Outro",C.teal],["Verse",C.teal],["Pre-chorus",C.gold],["Chorus",C.coral],["Bridge",C.muted],["Instrumental/solo",C.muted],["Breakdown/drop",C.amber],["Vocal activity",C.teal]] as Array<[string,typeof C.teal]>;
 let legendX=left;
 legend.forEach(([label,color])=>{
  page.drawRectangle({x:legendX,y:vocalY-20,width:5,height:5,color});
  page.drawText(label,{x:legendX+7,y:vocalY-19,size:4.35,font:fonts.regular,color:C.muted});
  legendX+=Math.min(65,fonts.regular.widthOfTextAtSize(label,4.35)+13);
  if(legendX>right-58)legendX=right-58;
 });
 const calloutTop=vocalY-31;
 page.drawText("TRANSITION CALLOUT GRID",{x:left,y:calloutTop,size:5.3,font:fonts.bold,color:C.ink});
 const calloutWidth=(barWidth-12)/3,calloutHeight=23,calloutY=calloutTop-7-calloutHeight;
 if(transitions.length){
  transitions.slice(0,3).forEach((item,index)=>{
   const cx=left+index*(calloutWidth+6);
   page.drawRectangle({x:cx,y:calloutY,width:calloutWidth,height:calloutHeight,color:C.paper,borderColor:C.line,borderWidth:.4});
   const label=String(item.id??("T"+(index+1)))+" "+formatSnapshotTime(Number(item.timestampSeconds))+" "+String(item.fromLabel??"Section")+" → "+String(item.toLabel??"Section");
   drawWrapped(page,label,cx+4,calloutTop-14,calloutWidth-8,fonts.bold,4.6,C.ink,5);
   drawWrapped(page,"Trigger: "+String(item.reason??"Spectral change"),cx+4,calloutTop-21,calloutWidth-8,fonts.regular,4.2,C.muted,4.6);
  });
 }else{
  page.drawText(hasMasterAudio?"No discrete transition trigger exceeded the provisional novelty, energy, chroma or vocal-state thresholds.":"Not analysed — no uploaded master signal supplied.",{x:left+4,y:calloutTop-19,size:4.8,font:fonts.italic,color:C.muted});
 }
 drawWrapped(page,hasMasterAudio?"Label basis: windowed spectral-flux novelty, RMS steps, chroma movement and vocal-band onset/offset; labels are provisional.":"Label basis: no uploaded master signal supplied; sections and transitions are not analysed.",left,calloutTop-38,barWidth,fonts.italic,4.4,C.muted,4.8);
 const kpiTop=calloutTop-47,kpiGap=6,kpiW=(barWidth-kpiGap*3)/4,kpiH=30;
 const kpis=[
  ["VOCAL PRESENCE",presence===null?"NOT ANALYSED":presence.toFixed(1)+"%"],
  ["VOCAL-BAND ENERGY",energy===null?"NOT ANALYSED":energy.toFixed(1)+" dBFS"],
  ["MEDIAN PITCH (F0)",pitch===null?"NOT ANALYSED":pitch.toFixed(1)+" Hz"],
  ["ACTIVITY INTERVALS",hasMasterAudio?String(intervals.length)+" timestamped":"NOT ANALYSED"],
 ];
 kpis.forEach((item,index)=>{
  const kx=left+index*(kpiW+kpiGap),ky=kpiTop-kpiH;
  page.drawRectangle({x:kx,y:ky,width:kpiW,height:kpiH,color:C.paper,borderColor:C.line,borderWidth:.45});
  page.drawText(item[0],{x:kx+4,y:kpiTop-9,size:4.6,font:fonts.bold,color:C.muted});
  drawWrapped(page,item[1],kx+4,kpiTop-21,kpiW-8,fonts.bold,6.2,C.ink,6.8);
 });
 const rangeTitleY=kpiTop-kpiH-12;
 page.drawText("PITCH RANGE (F0 CANDIDATES, 70–500 Hz SCALE)",{x:left,y:rangeTitleY,size:5.2,font:fonts.bold,color:C.ink});
 const rangeX=left,rangeW=barWidth,rangeBarY=rangeTitleY-10;
 page.drawRectangle({x:rangeX,y:rangeBarY,width:rangeW,height:6,color:C.paper,borderColor:C.line,borderWidth:.4});
 if(low!==null&&high!==null){
  const lo=Math.max(70,Math.min(500,low)),hi=Math.max(lo,Math.min(500,high));
  page.drawRectangle({x:rangeX+(lo-70)/430*rangeW,y:rangeBarY,width:Math.max(1,(hi-lo)/430*rangeW),height:6,color:C.amber});
 }
 if(pitch!==null){
  const px=rangeX+(Math.max(70,Math.min(500,pitch))-70)/430*rangeW;
  page.drawLine({start:{x:px,y:rangeBarY-2},end:{x:px,y:rangeBarY+9},color:C.coral,thickness:1});
 }
 page.drawText("70 Hz",{x:rangeX,y:rangeBarY-9,size:4.5,font:fonts.regular,color:C.muted});
 page.drawText(pitch===null?"F0 candidate range not analysed":"Median "+pitch.toFixed(1)+" Hz",{x:rangeX+rangeW/2-32,y:rangeBarY-9,size:4.5,font:fonts.bold,color:C.muted});
 page.drawText("500 Hz",{x:rangeX+rangeW-24,y:rangeBarY-9,size:4.5,font:fonts.regular,color:C.muted});
 const footerY=bottom+8;
 drawWrapped(page,hasMasterAudio?"WHAT IT SHOWS: Vocal-band energy locations, candidate pitch region and inferred section transitions from the uploaded master.":"WHAT IT SHOWS: No vocal or section measurements are available because this submission contains no uploaded master audio.",left,footerY+15,barWidth,fonts.regular,4.7,C.ink,5.1);
 drawWrapped(page,"WHAT IT DOES NOT SHOW: Exact labels, singing vs rap, lead vs backing, singer count, lyrics, delivery quality or audience response.",left,footerY+7,barWidth,fonts.italic,4.5,C.muted,4.9);
 return height;
}
export function snapshotPage3LayoutContract():{
 pageNumber:number;metricHeight:number;keyMapHeight:number;vocalModuleHeight:number;overviewHeight:number;
 vocalTop:number;vocalBottom:number;overviewTop:number;overviewBottom:number;bottomMargin:number;
}{
 const pageTop=H-92,metricHeight=SNAPSHOT_METRIC_CARD_HEIGHT,keyMapHeight=SNAPSHOT_KEY_MAP_HEIGHT;
 const vocalModuleHeight=SNAPSHOT_VOCAL_MODULE_HEIGHT,overviewHeight=SNAPSHOT_OVERVIEW_HEIGHT;
 const keyMapTop=pageTop-metricHeight-12;
 const vocalTop=keyMapTop-keyMapHeight-12,vocalBottom=vocalTop-vocalModuleHeight;
 const overviewTop=vocalBottom-10-8,overviewBottom=overviewTop-overviewHeight;
 return {pageNumber:3,metricHeight,keyMapHeight,vocalModuleHeight,overviewHeight,vocalTop,vocalBottom,overviewTop,overviewBottom,bottomMargin:overviewBottom};
}
function drawSnapshot(page:PDFPage,data:ReportV2Data,fonts:Fonts,input:AuditReportInput){
 const blocks=metricBlock(data,input),gap=10,width=(W-2*M-gap*2)/3,top=H-92;
 const metricHeight=Math.max(...blocks.map((b)=>drawMetricCard(page,M+blocks.indexOf(b)*(width+gap),top,width,b,fonts)));
 let y=top-metricHeight-12;
 const keyMapHeight=drawCircleOfFifths(page,input,data,fonts,y);
 y-=keyMapHeight+12;
 const vocalHeight=drawVocalArrangementCard(page,y,fonts,input);
 y-=vocalHeight+10;
 const sonic=rec(input.sonicDna),vocal=rec(input.vocalAndSectionPageData??sonic.vocalArrangementAnalysis??sonic.vocalFeatures);
 const hasMasterAudio=hasSubmittedMasterAudio(rec(input.evidence),Object.keys(sonic).length?sonic:null);
 const duration=finite(sonic.durationSeconds)?sonic.durationSeconds:null;
 const presence=hasMasterAudio&&finite(vocal.vocalPresencePct)?vocal.vocalPresencePct:null;
 const sections=arr(vocal.inferredSections),transitions=arr(vocal.detectedTransitions);
 const keyRaw=buildRecordingOverviewKeyLabel(data),keyLabel=data.key.value!==null?"Confirmed: "+keyRaw:/^Provisional:/i.test(keyRaw)?keyRaw:keyRaw==="Unavailable"?"Unavailable":"Provisional: "+keyRaw;
 const tempoRaw=buildCoverTempoLabel(data,input).replace(/\s*·\s*CANDIDATE$/i,"").replace(/\s*·\s*CONFIRMED$/i,"");
 const tempoLabel=tempoRaw==="Not determined"?"Not analysed":tempoRaw+(data.tempo.value===null?" CANDIDATE":" CONFIRMED");
 const vocalStatus=!hasMasterAudio?"Not analysed":vocal.vocalActivityStatus==="SIGNAL_ACTIVITY_DETECTED"&&presence!==null&&presence>0?"Detected (inferred)":"Minimal / Instrumental";
 const rows:Array<[string,string,string,string]>=[
  ["Track length",duration===null?"Not analysed":Math.floor(duration/60)+" min "+Math.round(duration%60)+" sec","Format",typeof sonic.channels==="number"?(sonic.channels===2?"Stereo":sonic.channels===1?"Mono":sonic.channels+" channels"):"Not analysed"],
  ["Song key",keyLabel,"Tempo",tempoLabel],
  ["Vocals",vocalStatus,"Vocal activity",presence===null?"Not analysed":presence.toFixed(1)+"%"],
  ["Sections",hasMasterAudio?sections.length+" INFERRED":"Not analysed","Transitions",hasMasterAudio?transitions.length+" detected":"Not analysed"]
 ];
 const panelHeight=SNAPSHOT_OVERVIEW_HEIGHT,panelTop=y-8,bottom=panelTop-panelHeight;
 page.drawRectangle({x:M,y:bottom,width:W-2*M,height:panelHeight,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawText("RECORDING OVERVIEW",{x:M+12,y:panelTop-14,size:7,font:fonts.bold,color:C.gold});
 rows.forEach((row,index)=>{
  const yy=panelTop-30-index*16;
  page.drawText(row[0],{x:M+12,y:yy,size:5.7,font:fonts.regular,color:C.muted});
  drawWrapped(page,row[1],M+82,yy,142,fonts.bold,5.8,C.ink,6.5);
  page.drawText(row[2],{x:M+260,y:yy,size:5.7,font:fonts.regular,color:C.muted});
  drawWrapped(page,row[3],M+334,yy,155,fonts.bold,5.8,C.ink,6.5);
 });
 page.drawText(hasMasterAudio?"Uploaded-master descriptors only; no mastering-readiness or audience conclusion is implied.":"No uploaded master audio supplied; master-derived descriptors are not measured.",{x:M+12,y:bottom+5,size:5.4,font:fonts.italic,color:C.muted});
}
function drawExecutionMilestoneTrack(page:PDFPage,top:number,fonts:Fonts,labels:string[]):void{
 const required=["Days 1–30","Days 31–60","Days 61–90"],x=M+18,width=W-2*M-36,y=top-22,step=width/3;
 const reconciled=reconcileChartSeriesAndLabels({rows:required.map(label=>({label,value:null})),expectedLabels:required,provenance:"PROPOSED · EXECUTION PLAN"});
 draw3DSolidBar(page,x+step*.5,y+6,step*2,2,C.teal);
 reconciled.rows.forEach((row,index)=>{const cx=x+step*(index+.5);draw3DSolidSphere(page,cx,y+7,8,index===0?C.teal:index===1?C.amber:C.violet);page.drawText(row.label,{x:cx-28,y:y-10,size:5.8,font:fonts.bold,color:C.ink});const supplied=labels[index];drawWrapped(page,supplied??"Action detail not supplied.",cx-step*.5+3,y-21,step-6,fonts.regular,4.8,C.muted,5.4);});
}
function drawSonicAxes(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const axes=data.sonicAxes!;const names=Object.keys(axes) as Array<keyof typeof axes>,cx=170,cy=555,r=118;
 for(let ring=1;ring<=4;ring++){const rr=r*ring/4;for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5,b=-Math.PI/2+(i+1)*2*Math.PI/5;page.drawLine({start:{x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr},end:{x:cx+Math.cos(b)*rr,y:cy+Math.sin(b)*rr},color:C.line,thickness:.6});}}
 const pts=names.map((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5,v=axes[name].value/100;return {x:cx+Math.cos(a)*r*v,y:cy+Math.sin(a)*r*v};});
 const polygon=pts.map((point,i)=>(i?"L ":"M ")+point.x.toFixed(2)+" "+point.y.toFixed(2)).join(" ")+" Z";
 const extrusion=pts.map((point,i)=>(i?"L ":"M ")+(point.x+5).toFixed(2)+" "+(point.y-5).toFixed(2)).join(" ")+" Z";
 pts.forEach((point,i)=>{const next=pts[(i+1)%pts.length];page.drawSvgPath(`M ${point.x} ${point.y} L ${next.x} ${next.y} L ${next.x+5} ${next.y-5} L ${point.x+5} ${point.y-5} Z`,{color:C.charcoal,opacity:.28});});
 page.drawSvgPath(extrusion,{color:C.charcoal,opacity:.3});
 page.drawSvgPath(polygon,{color:C.teal,opacity:.32,borderColor:C.white,borderOpacity:.65,borderWidth:1.8});
 pts.forEach((point)=>draw3DSolidSphere(page,point.x,point.y,4,C.teal));
 names.forEach((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;const x=cx+Math.cos(a)*(r+22),y=cy+Math.sin(a)*(r+22);page.drawText(name+" "+axes[name].value,{x:x-28,y,size:7,font:fonts.bold,color:C.ink});});
 const note="Supplied axis scores only. Scale: 0–100; higher values indicate a higher score on that named axis. No reference average or audience-overlap claim is implied.";
 drawWrapped(page,note,330,cy+60,180,fonts.regular,8,C.muted,11);

 let y=cy-155;
 names.forEach(name=>{const item=axes[name];page.drawRectangle({x:M,y:y-15,width:W-2*M,height:38,color:C.white,borderColor:C.line,borderWidth:.6});page.drawText(name,{x:M+12,y:y+8,size:8,font:fonts.bold,color:C.ink});page.drawRectangle({x:M+112,y:y+5,width:150,height:6,color:C.line});draw3DSolidBar(page,M+112,y+5,150*item.value/100,6,item.value<60?C.amber:C.teal);page.drawText(String(item.value),{x:M+270,y:y+5,size:8,font:fonts.bold,color:C.ink});drawWrapped(page,item.note??"Axis note not supplied.",M+310,y+8,190,fonts.regular,7,C.muted,9);y-=45;});
}
function drawComparables(page:PDFPage,input:AuditReportInput,data:ReportV2Data,fonts:Fonts){
 const e=rec(input.evidence),position=rec(e.marketPosition),score=typeof position.score==="number"&&Number.isFinite(position.score)?position.score:null;
 let y=H-104;
 if(score===null){
  card(page,M,y,W-2*M,"Market position not scored",["No supported market-position score or audience benchmark was supplied. The source-attributed comparables below are context only; they do not establish audience reach, playlist placement or campaign performance."],fonts,{accent:C.amber});
  y-=76;
 }
 if(score!==null){
  card(page,M,y,W-2*M,"Market position",[score+" / 100 · "+str(position.label,"Position label not supplied"),"Basis: "+str(position.basis,"Source-attributed comparables")],fonts,{accent:C.gold});
  const barX=M+14,barY=y-52,barW=W-2*M-28;page.drawRectangle({x:barX,y:barY,width:barW,height:12,color:C.line});draw3DSolidBar(page,barX,barY,barW*score/100,12,C.teal);page.drawCircle({x:barX+barW*score/100,y:barY+6,size:7,color:C.white,borderColor:C.ink,borderWidth:1});y-=105;
 }
 card(page,M,y,W-2*M,"Closest comparables",[],fonts,{height:28+data.comparables!.length*43,accent:C.gold});
 drawWrapped(page,"Source-reported similarity is not a measure of audience overlap, playlist reach or predicted commercial performance. Compare only within each source's stated methodology.",M+14,y-24,W-2*M-28,fonts.italic,6.5,C.muted,8);
 const top=y-48;data.comparables!.forEach((c,i)=>{const yy=top-i*43;page.drawText(c.title,{x:M+14,y:yy,size:8,font:fonts.bold,color:C.ink});page.drawText(String(c.year)+" · "+c.lane,{x:M+170,y:yy,size:7,font:fonts.regular,color:C.muted});page.drawText(c.similarity+"%",{x:W-M-45,y:yy,size:8,font:fonts.bold,color:C.teal});drawWrapped(page,c.basis+" · "+c.source,M+14,yy-12,W-2*M-28,fonts.regular,6.5,C.muted,8);page.drawLine({start:{x:M+12,y:yy-20},end:{x:W-M-12,y:yy-20},color:C.line,thickness:.5});});
}
function drawMoments(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const moments=data.moments!,top=H-104,left=M+22,right=W-M-22,mid=top-45;
 page.drawRectangle({x:M,y:mid-30,width:W-2*M,height:90,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawLine({start:{x:left,y:mid},end:{x:right,y:mid},color:C.gold,thickness:1.4});
 const max=Math.max(...moments.map(m=>m.timestampSeconds),1);
 page.drawText("TRACK POSITION · SECONDS",{x:left,y:top-14,size:6.5,font:fonts.bold,color:C.muted});
 page.drawText("0s",{x:left,y:mid-42,size:6,font:fonts.regular,color:C.muted});
 page.drawText(max.toFixed(1)+"s",{x:right-24,y:mid-42,size:6,font:fonts.regular,color:C.muted});
 moments.forEach((m,i)=>{const x=left+(m.timestampSeconds/max)*(right-left);const color=m.tag==="Risk"?C.coral:m.tag==="Check"?C.amber:C.teal;draw3DSolidBar(page,x-.9,mid-23,1.8,47,color);draw3DSolidSphere(page,x,mid+26,8,color);page.drawText(String(i+1),{x:x-2.5,y:mid+23,size:6,font:fonts.bold,color:C.white});page.drawText(m.timestampSeconds.toFixed(1)+"s",{x:x-14,y:mid-34-(i%2)*9,size:6,font:fonts.bold,color});});
 draw3DSolidSphere(page,M+17,mid-9,2.5,C.teal);page.drawText("Strength",{x:M+24,y:mid-12,size:6.5,font:fonts.bold,color:C.teal});
 draw3DSolidSphere(page,M+98,mid-9,2.5,C.amber);page.drawText("Check",{x:M+105,y:mid-12,size:6.5,font:fonts.bold,color:C.amber});
 draw3DSolidSphere(page,M+164,mid-9,2.5,C.coral);page.drawText("Risk",{x:M+171,y:mid-12,size:6.5,font:fonts.bold,color:C.coral});
 let y=mid-48;
 moments.forEach((m,i)=>{const h=card(page,M,y,W-2*M,m.timestampSeconds.toFixed(2)+"s · "+m.title,[m.note],fonts,{accent:m.tag==="Risk"?C.coral:m.tag==="Check"?C.amber:C.teal});y-=h+8;});
 card(page,M,y,W-2*M,"How moments are chosen",["Moments are rendered from supplied timestamped detector output or device flags. This report does not create or infer additional flags."],fonts,{accent:C.gold});
}

export function partitionFullReportUnits<T>(
 units:T[],
 heights:number[],
 pageCount:number,
 capacity:number,
):T[][]|null{
 if(!Number.isInteger(pageCount)||pageCount<1||units.length<pageCount
  ||heights.length!==units.length||!Number.isFinite(capacity)||capacity<=0)return null;
 if(heights.some(height=>!Number.isFinite(height)||height<=0||height>capacity))return null;
 const canFit=(limit:number):boolean=>{
  let pages=1,used=0;
  for(const height of heights){
   if(used+height>limit+1e-7){pages++;used=height;}
   else used+=height;
  }
  return pages<=pageCount;
 };
 if(!canFit(capacity))return null;
 let low=Math.max(...heights),high=capacity;
 for(let iteration=0;iteration<52;iteration++){
  const middle=(low+high)/2;
  if(canFit(middle))high=middle;
  else low=middle;
 }
 const pages:T[][]=[];
 let page:T[]=[],used=0;
 for(let index=0;index<units.length;index++){
  if(page.length>0&&used+heights[index]>high+1e-6){
   pages.push(page);page=[];used=0;
  }
  page.push(units[index]);used+=heights[index];
 }
 if(page.length)pages.push(page);
 while(pages.length<pageCount){
  let splitIndex=-1,largestPage=1;
  for(let index=0;index<pages.length;index++){
   if(pages[index].length>largestPage){largestPage=pages[index].length;splitIndex=index;}
  }
  if(splitIndex<0)return null;
  const current=pages[splitIndex],midpoint=Math.floor(current.length/2);
  pages.splice(splitIndex,1,current.slice(0,midpoint),current.slice(midpoint));
 }
 return pages.length===pageCount?pages:null;
}

function drawArNotesPage(page:PDFPage,input:AuditReportInput,data:ReportV2Data,fonts:Fonts,form:ReturnType<PDFDocument["getForm"]>):void {
 const chipGap=7,chipWidth=(W-2*M-chipGap*3)/4,chipY=704;
 const colors=[C.teal,C.gold,C.teal,C.gold] as const;
 data.decisionDimensions.forEach((dimension,index)=>{
  scoreChip(page,M+index*(chipWidth+chipGap),chipY,chipWidth,dimension.name.toUpperCase(),dimension.status,colors[index]??C.gold,fonts);
 });
 const assessment=rec(input.assessment);
 const checklist=arr(assessment.humanListeningChecklist)
  .map(value=>str(value,"")).filter(value=>value&&value!=="Not supplied");
 const reviewItems=checklist.length?checklist:[
  "Confirm the lead vocal performance, intelligibility and emotional delivery.",
  "Listen for timing, groove and the intended half-time or double-time feel.",
  "Check arrangement transitions, hook impact and section balance.",
  "Review mix translation, clipping, distortion and low-frequency control.",
  "Confirm the strongest excerpt and any edit points by listening to the master."
 ];
 const reviewTop=690,reviewHeight=94;
 card(page,M,reviewTop,W-2*M,"Human listening review",[],fonts,{height:reviewHeight,accent:C.label});
 const columns=reviewItems.length>3?2:1,rows=Math.ceil(reviewItems.length/columns),rowGap=50/Math.max(1,rows-1);
 reviewItems.forEach((item,index)=>{
  const col=columns===2?Math.floor(index/rows):0,row=columns===2?index%rows:index;
  const x=M+12+col*255,y=reviewTop-34-row*rowGap;
  page.drawRectangle({x,y:y-1,width:8,height:8,borderColor:C.gold,borderWidth:.8,color:C.white});
  drawWrapped(page,item,x+14,y+5,columns===2?235:W-2*M-42,fonts.regular,5,C.ink,5.4);
 });
 const context=buildArNotesDecisionContextFull(input);
 const contextTop=578,contextHeight=150,contextBottom=contextTop-contextHeight;
 card(page,M,contextTop,W-2*M,"A&R decision context",[],fonts,{height:contextHeight,accent:C.teal});
 const contextText=context.verdict+" · "+context.summary;
 let contextFontSize=6.2,contextLineHeight=7.2;
 while(wrap(contextText,fonts.regular,contextFontSize,W-2*M-24).length*contextLineHeight>66&&contextFontSize>5){contextFontSize-=0.2;contextLineHeight-=0.2;}
 const contextLineCount=wrap(contextText,fonts.regular,contextFontSize,W-2*M-24).length;
 if(contextLineCount*contextLineHeight>66)throw new Error("A&R Notes decision context exceeds its reserved page area");
 drawWrapped(page,contextText,M+12,contextTop-33,W-2*M-24,fonts.regular,contextFontSize,C.ink,contextLineHeight);
 const promptTop=contextBottom+28,promptGap=8,promptWidth=(W-2*M-24-promptGap*2)/3;
 context.prompts.slice(0,3).forEach((prompt,index)=>{
  const x=M+12+index*(promptWidth+promptGap);
  page.drawLine({start:{x,y:promptTop+10},end:{x:x+promptWidth,y:promptTop+10},color:C.line,thickness:.7});
  drawWrapped(page,prompt,x,promptTop,promptWidth,fonts.bold,6.1,C.muted,7.2);
 });


 const notesX=M,notesY=112,notesWidth=W-2*M,notesHeight=300;
 page.drawText("WORKING NOTES · EDITABLE",{x:notesX,y:notesY+notesHeight+10,size:7,font:fonts.bold,color:C.label});
 const notes=form.createTextField("ar_notes");
 notes.enableMultiline();
 notes.addToPage(page,{x:notesX,y:notesY,width:notesWidth,height:notesHeight,borderWidth:.7,borderColor:C.gold});
 notes.setFontSize(8);
 notes.updateAppearances(fonts.regular);
 for(let line=1;line<=17;line++){
  const y=notesY+line*16;
  page.drawLine({start:{x:notesX+9,y},end:{x:notesX+notesWidth-9,y},color:C.line,thickness:.45});
 }

 const owner=form.createTextField("ar_owner");
 owner.addToPage(page,{x:M,y:78,width:128,height:18,borderWidth:.6,borderColor:C.line,backgroundColor:C.white});
 owner.setFontSize(7);owner.updateAppearances(fonts.regular);
 page.drawText("A&R OWNER",{x:M,y:100,size:6,font:fonts.bold,color:C.label});
 const followup=form.createTextField("ar_followup_date");
 followup.addToPage(page,{x:M+150,y:78,width:88,height:18,borderWidth:.6,borderColor:C.line,backgroundColor:C.white});
 followup.setFontSize(7);followup.updateAppearances(fonts.regular);
 page.drawText("FOLLOW-UP DATE",{x:M+150,y:100,size:6,font:fonts.bold,color:C.label});
 const decisions=[
  ["ar_decision_hold","HOLD",M+258],
  ["ar_decision_reaudit","RE-AUDIT",M+340],
  ["ar_decision_proceed","PROCEED",M+432],
 ] as const;
 for(const [name,label,x] of decisions){
  const field=form.createCheckBox(name);
  field.addToPage(page,{x,y:82,width:9,height:9,borderWidth:.8,borderColor:C.gold,backgroundColor:C.white});

  page.drawText(label,{x:x+13,y:83,size:6.1,font:fonts.bold,color:C.ink});
 }
}

function assertRenderActive(signal?:AbortSignal):void{
 if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new Error("PDF_RENDER_ABORTED");
}
async function yieldRenderTurn(signal?:AbortSignal):Promise<void>{
 assertRenderActive(signal);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assertRenderActive(signal);
}

export async function generateAuditReportV2(source:AuditReportInput,tier:AuditReportTier="sample",signal?:AbortSignal):Promise<Uint8Array>{
 assertRenderActive(signal);
 const input:AuditReportInput={...source,assessment:sanitizeAssessmentForEvidence(rec(source.assessment),rec(source.sonicDna),rec(source.evidence)) as AuditReportInput["assessment"]};
 const data=adaptReportV2(input),pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf),form=pdf.getForm();
 const pages=buildReportSections(input,data,tier).map(spec=>({...spec,lines:sanitizePublicReportLines(spec.lines??[]),blocks:spec.blocks.map(block=>({...block,value:sanitizePublicReportLine(block.value),provenance:sanitizePublicReportLine(block.provenance??"")||(spec.kind==="narrative"?"":"From uploaded recording"),confidence:block.confidence}))})),total=pages.length;
 // input.assessment is already the canonical evidence-sanitized assessment at this boundary.
 // Reuse that exact object for source counts and chart rows; re-sanitizing a sanitized
 // assessment can remove risk language a second time and create false count drift.
 const safeAssessment=rec(input.assessment);
 const platformPanel=chartsForSection(input,"Identity and source reconciliation",safeAssessment as AuditReportInput["assessment"])[0];
 const evidencePanel=chartsForSection(input,"Evidence ledger and provenance",safeAssessment as AuditReportInput["assessment"])[0];
 const strengthPanel=chartsForSection(input,"Strengths and creative leverage",safeAssessment as AuditReportInput["assessment"])[0];
 const executionPanel=chartsForSection(input,"30 / 60 / 90-day execution plan",safeAssessment as AuditReportInput["assessment"])[0];
 const catalogSources=arr(rec(input.evidence).catalogSources).filter(item=>item&&typeof item==="object");
 const platformCount=platformPanel?.rows.reduce((sum,row)=>sum+(typeof row.value==="number"?row.value:0),0)??0;
 const evidenceCounts=countEvidenceLayers(arr(safeAssessment.evidenceLabels).map(value=>rec(value) as {label:string}));
 const evidenceCount=Object.values(evidenceCounts).reduce((sum,value)=>sum+value,0);
 const strengths=buildStrengthRiskSummary(input,safeAssessment);
 const consistencyErrors=reconcileChartCrossChecks({
  platformLookupCount:catalogSources.length,platformChartCount:platformCount,
  evidenceClaimCount:evidenceCount,evidenceChartCount:evidencePanel?.rows.reduce((sum,row)=>sum+(typeof row.value==="number"?row.value:0),0)??0,
  strengthCount:strengths.strengthCount,strengthChartCount:typeof strengthPanel?.rows[0]?.value==="number"?strengthPanel.rows[0].value:undefined,
  riskCount:strengths.riskCount,riskChartCount:typeof strengthPanel?.rows[1]?.value==="number"?strengthPanel.rows[1].value:undefined,
  executionLabels:executionPanel?.rows.map(row=>row.label)
 });
 if(consistencyErrors.length)throw new Error("Chart data reconciliation failed: "+consistencyErrors.join(" "));

 if((tier==="sample"&&pages.length!==7)||(tier==="full"&&pages.length<12))throw new Error("Report section configuration does not match the approved "+tier+" page allocation.");
 for(let index=0;index<pages.length;index++){
  const spec=pages[index],page=pageBase(pdf,tier==="full"&&index===0?"Full A&R report":spec.title,fonts);
  let chartCursor=H-380;
  if(spec.kind==="identity"){
   chartCursor=drawIdentityReconciliation(page,input,fonts);
  }else if(spec.kind==="snapshot"){
   drawSnapshot(page,data,fonts,input);
  }else if(spec.kind==="ar-notes"){
   drawArNotesPage(page,input,data,fonts,form);
  }else if(spec.kind==="full-axes"){
   if(data.sonicAxes)drawSonicAxes(page,data,fonts);
   else card(page,M,H-105,W-2*M,"Sonic DNA dashboard",data.notYetMeasured.filter(value=>/Sonic DNA/i.test(value)).length?data.notYetMeasured.filter(value=>/Sonic DNA/i.test(value)):["NOT MEASURED: all five source-backed Sonic DNA axes are not present."],fonts,{accent:C.amber});
  }else if(spec.kind==="tempo-energy"){
   const tempoLines=[data.tempo.value===null
    ?"Tempo not confirmed from the recording."
    :"Measured tempo: "+data.tempo.value+" BPM."];
   card(page,M,H-105,W-2*M,data.tempo.value===null?"Tempo":"Tempo · CONFIRMED",tempoLines,fonts,{accent:data.tempo.value===null?C.amber:C.teal});
   const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
   const candidates=(hasReportableKeyCandidates(rec(input.sonicDna))?arr(harmonic.topCandidates):[]).map(value=>rec(value))
    .map(item=>[str(item.key,""),str(item.mode,"")].filter(Boolean).join(" ")).filter(Boolean).slice(0,4);
   const keyLines=[data.key.value!==null
    ?"Confirmed song key: "+String(data.key.value)+"."
    :candidates.length?"Song key not confirmed. Possible tonal centres: "+candidates.join(", ")+"."
    :"Song key not determined from the recording."];
   card(page,M,H-245,W-2*M,data.key.value===null?"Song key":"Song key · CONFIRMED",keyLines,fonts,{accent:data.key.value===null?C.amber:C.teal});
   const energy=data.energy.value===null?"Playback level was not measured.":"Playback level measurements are available from the uploaded recording.";
   card(page,M,H-385,W-2*M,"Playback level", [energy],fonts,{accent:data.energy.value===null?C.amber:C.teal});
   if(data.energySeries){
    const top=H-540,height=220,left=M+28,right=W-M-18,bottom=top-height+32;
    page.drawRectangle({x:M,y:top-height,width:W-2*M,height,color:C.white,borderColor:C.line,borderWidth:.7});
    page.drawText("ENERGY SPECTRUM · SOURCE VALUES",{x:M+12,y:top-17,size:7,font:fonts.bold,color:C.gold});
    const series=reconcileChartSeriesAndLabels({rows:data.energySeries.map(point=>({label:point.timeSeconds.toFixed(1)+" s",value:point.value})),endpointAvailable:true,metricAvailable:true,derivedInProcess:true,provenance:"SIGNAL-DERIVED · TIMESTAMPED UPLOADED-MASTER SERIES"});
    let min=Infinity,max=-Infinity;for(const row of series.rows){if(typeof row.value!=="number")continue;if(row.value<min)min=row.value;if(row.value>max)max=row.value;}if(!Number.isFinite(min)||!Number.isFinite(max)){min=0;max=0;}const span=max-min||1;
    const t0=data.energySeries[0].timeSeconds,t1=data.energySeries[data.energySeries.length-1].timeSeconds,dt=t1-t0||1;
    for(let i=0;i<series.rows.length;i++){
     const value=typeof series.rows[i]!.value==="number"?Number(series.rows[i]!.value):null;
     if(value===null)continue;
     const point=data.energySeries[i]!,barX=left+(point.timeSeconds-t0)/dt*(right-left);
     draw3DSolidBar(page,barX-2,bottom,4,Math.max(2,(value-min)/span*(top-48-bottom)),C.teal);
    }
    page.drawText("Elapsed "+t0.toFixed(1)+"–"+t1.toFixed(1)+" s",{x:left,y:bottom-15,size:6,font:fonts.regular,color:C.muted});
   }else{
    const audio=rec(input.sonicDna);
    const candidates=[
     ["Integrated loudness",audio.integratedLoudnessLufs??audio.loudnessLufs,"LUFS",-60,0],
     ["Loudness range",audio.loudnessRangeLu,"LU",0,20],
     ["True peak",audio.truePeakDbfs,"dBFS",-60,0],
     ["RMS level",audio.rmsDbfs??audio.rmsLevelDbfs,"dBFS",-60,0],
    ] as Array<[string,unknown,string,number,number]>;
    const rows=candidates.filter((item):item is [string,number,string,number,number]=>typeof item[1]==="number"&&Number.isFinite(item[1])).map(item=>({label:item[0]+" "+item[2],value:item[1]}));
    const reconciled=reconcileChartSeriesAndLabels({rows,endpointAvailable:true,metricAvailable:rows.length>0,derivedInProcess:false,provenance:"MEASURED · DECODED UPLOADED-MASTER METRICS"});
    if(reconciled.rows.length){
     const boxTop=H-540,boxHeight=220,boxBottom=boxTop-boxHeight;
     page.drawRectangle({x:M,y:boxBottom,width:W-2*M,height:boxHeight,color:C.white,borderColor:C.line,borderWidth:.7});
     page.drawText("MASTER METRIC PROFILE · NO TIMESTAMPED SERIES",{x:M+12,y:boxTop-17,size:7,font:fonts.bold,color:C.gold});
     page.drawText("MEASURED VALUES · COARSE OVERVIEW · NOT A TIME SERIES",{x:M+12,y:boxTop-30,size:5.5,font:fonts.italic,color:C.muted});
     rows.forEach((row,index)=>{
      const meta=candidates.find(item=>item[0]+" "+item[2]===row.label)!;
      const value=Number(row.value),ratio=Math.max(0,Math.min(1,(value-meta[3])/(meta[4]-meta[3]))),yy=boxTop-62-index*34;
      page.drawText(row.label,{x:M+14,y:yy+8,size:6.5,font:fonts.bold,color:C.ink});
      page.drawRectangle({x:M+155,y:yy,width:280,height:7,color:C.line});
      draw3DSolidBar(page,M+155,yy,280*ratio,7,index%2?C.violet:C.teal);
      page.drawText(value.toFixed(1)+" "+meta[2],{x:M+445,y:yy-1,size:6.5,font:fonts.bold,color:C.ink});
     });
     page.drawText(reconciled.provenance,{x:M+14,y:boxBottom+12,size:5.5,font:fonts.bold,color:C.muted});
     page.drawText("Dedicated timestamped energy endpoint absent — no temporal shape is inferred.",{x:M+14,y:boxBottom+3,size:5.2,font:fonts.regular,color:C.muted});
    }else card(page,M,H-540,W-2*M,"Energy spectrum · Endpoint pending",["ENDPOINT PENDING — no timestamped series or decoded loudness/headroom metric is available. No chart values are fabricated."],fonts,{accent:C.amber});
   }
  }else if(spec.kind==="full-depth"){
   const assessment=rec(input.assessment),release=rec(assessment.releaseStrategy);
   const scoreLines=data.headlineScore===null?["NOT MEASURED: no validated headline score was supplied.",...(data.scoreDrivers??[]).map(driver=>driver.label+": "+driver.score+"/100 · "+(driver.evidence||"Evidence note not supplied"))]:["Supplied assessment score: "+data.headlineScore+"/100",...(data.scoreDrivers??[]).map(driver=>driver.label+": "+driver.score+"/100 · "+(driver.evidence||"Evidence note not supplied"))];
   card(page,M,H-105,W-2*M,"Evidence scorecard",scoreLines,fonts,{accent:C.gold});
   const rawTimeline=Array.isArray(release.executionTimeline)?release.executionTimeline:Array.isArray(assessment.executionTimeline)?assessment.executionTimeline:[];
   const timelineLines=rawTimeline.map(value=>{const row=rec(value);return [str(row.label??row.phase??row.title,""),str(row.timing??row.when??row.window,""),str(row.action??row.description??row.task,"")].filter(value=>value&&value!=="Not supplied").join(" · ");}).filter(Boolean);
   card(page,M,H-245,W-2*M,"Execution timeline · PLAN",timelineLines.length?["ILLUSTRATIVE PLAN — proposed guidance, not a verified campaign outcome.",...timelineLines]:["NOT SUPPLIED: no execution timeline was included in the persisted assessment."],fonts,{accent:C.amber});
   drawExecutionMilestoneTrack(page,H-340,fonts,["Prepare assets, metadata and initial pitches","Review response signals and refine creative","Re-pitch qualified lanes and document next cycle"]);
   card(page,M,H-430,W-2*M,"Playback note",["Measurements describe the supplied recording only. A final mastering decision requires a dedicated listening review."],fonts,{accent:C.gold});
  }else if(spec.kind==="axes"){
   drawSonicAxes(page,data,fonts);
  }else if(spec.kind==="comparables"){
   drawComparables(page,input,data,fonts);
  }else if(spec.kind==="moments"){
   drawMoments(page,data,fonts);
  }else if(spec.kind==="cover"){
   const e=rec(input.evidence),a=rec(input.assessment);
   if(tier==="sample")page.drawText("TRACK AUDIT",{x:M,y:H-112,size:8,font:fonts.bold,color:C.gold});
   drawWrapped(page,str(e.artist,"Artist not supplied"),M,H-155,W-2*M,fonts.bold,22,C.ink,27);
   drawWrapped(page,str(e.title,"Track not supplied"),M,H-186,W-2*M,fonts.regular,14,C.muted,18);
   page.drawText("AUDIT "+input.auditId+"  ·  "+dateText(input.generatedAt)+"  ·  "+dateText(e.releaseDate),{x:M,y:H-210,size:7,font:fonts.regular,color:C.muted});
   const chipY=H-260,chipGap=8,chipWidth=(W-2*M-chipGap*3)/4;
   const chipColors=[C.teal,C.amber,C.coral,C.gold] as const;
   data.decisionDimensions.forEach((dimension,index)=>{
    scoreChip(page,M+index*(chipWidth+chipGap),chipY,chipWidth,dimension.name,dimension.status,chipColors[index]??C.gold,fonts);
   });
   if(data.headlineScore!==null){
    const ringX=M+65,ringY=H-355;
    draw3DSolidSphere(page,ringX,ringY,43,C.paper);
    page.drawCircle({x:ringX,y:ringY,size:43,color:C.white,borderColor:C.teal,borderWidth:7});
    page.drawText(String(data.headlineScore),{x:ringX-18,y:ringY-7,size:19,font:fonts.bold,color:C.ink});
    page.drawText("SCORE",{x:ringX-13,y:ringY-21,size:6,font:fonts.bold,color:C.teal});
    page.drawText("SCORE DRIVERS",{x:M+145,y:H-315,size:7,font:fonts.bold,color:C.muted});
    const drivers=data.scoreDrivers??[];
    drivers.forEach((d,i)=>{const yy=H-340-i*23;page.drawText(d.label,{x:M+145,y:yy,size:7,font:fonts.bold,color:C.ink});page.drawRectangle({x:M+245,y:yy-2,width:205,height:7,color:C.line});draw3DSolidBar(page,M+245,yy-2,205*d.score/100,7,d.score<60?C.amber:C.teal);page.drawText(String(d.score),{x:M+460,y:yy-2,size:7,font:fonts.bold,color:C.ink});});
    const weights=drivers.length&&drivers.every(d=>d.weight!==null)?drivers.map(d=>d.label+" "+Math.round((d.weight??0)*100)+"%").join(", "):"Weighting not supplied.";
    page.drawText("Weighting: "+weights,{x:M+145,y:H-340-drivers.length*23-6,size:6.5,font:fonts.italic,color:C.muted});
   }
   const metricTop=H-(data.headlineScore!==null?420:320),width=(W-2*M-16)/3;
   const metricHeight=Math.max(...spec.blocks.map((block,i)=>drawMetricCard(page,M+i*(width+8),metricTop,width,block,fonts)));
   const summary=spec.lines?.[2]??"Executive summary not supplied.";
   const next=spec.lines?.[3]??"Recommended next step not supplied.";
   const summaryTop=metricTop-Math.max(130,metricHeight+20);
   card(page,M,summaryTop,W-2*M,"Executive summary and recommended next step",[
    summary.replace(/^Executive summary:\s*/,""),
    next.replace(/^Recommended next step:\s*/,"")
   ],fonts,{accent:C.gold});
   page.drawText("IN THIS REPORT",{x:M,y:160,size:7,font:fonts.bold,color:C.gold});
   const toc=pages.slice(1),rowsPerColumn=Math.ceil(toc.length/2);
   toc.forEach((p,i)=>{
    const col=i<rowsPerColumn?0:1,row=i<rowsPerColumn?i:i-rowsPerColumn;
    const x=M+col*250,y=142-row*14;
    page.drawText(String(i+2).padStart(2,"0"),{x,y,size:7,font:fonts.bold,color:C.gold});
    drawWrapped(page,p.title,x+28,y,205,fonts.regular,6.6,C.ink,7.4);
   });
  }else if(spec.kind==="narrative"){
   let y=H-92;
   const compactNarrative=spec.title==="Promotion and campaign strategy";
   const narrativeBlocks=compactNarrative?spec.blocks.map(b=>({...b,value:b.value.length>200?b.value.slice(0,197).replace(/\\s+\\S*$/,"").trimEnd()+"…":b.value})):spec.blocks;
   for(const b of narrativeBlocks){
    const h=card(page,M,y,W-2*M,b.label,[b.value],fonts,{accent:C.gold,provenance:b.provenance,compact:compactNarrative});
    y-=h+(compactNarrative?3:6);
    if(b.arrangementBar?.length){const barHeight=drawProposedArrangementBar(page,y,b.arrangementBar,fonts);y-=barHeight+5;}
   }
   if(y<76)throw new Error("Report v2 narrative page content exceeds safe footer clearance: "+spec.title);
  }else if(spec.kind==="axes"||spec.kind==="comparables"||spec.kind==="moments"){
   let y=H-92;for(const b of spec.blocks){const h=card(page,M,y,W-2*M,b.label,[b.value],fonts,{accent:spec.kind==="moments"?(b.label.includes("Risk")?C.coral:C.teal):C.gold,provenance:b.provenance});y-=h+8;}
  }else{
   let y=H-92;
   if(spec.blocks.length){for(const b of spec.blocks){const h=card(page,M,y,W-2*M,b.label,[b.value],fonts,{accent:C.gold,provenance:b.provenance});y-=h+8;}}
   if(spec.lines?.length){
    const body=spec.lines.filter(Boolean),h=card(page,M,y,W-2*M,spec.title,body,fonts,{accent:C.gold});
    if(h>y-95)throw new Error("Report v2 page content exceeds available A4 space: "+spec.title);
    chartCursor=y-h-14;
   }
  }
  const legacyChartSection: Record<string,string> = {
   "Identity and source reconciliation":"Identity and source reconciliation",
   "A&R positioning":"Creative identity and A&R positioning",
   "Strengths, risks and actions":"Strengths and creative leverage",
   "Release and promotion plan":"Promotion plan"
  };
  const chartSection=legacyChartSection[spec.title];
  if(chartSection){
   // Anchor evidence panels to the actual end of the page's content card.
   // The fit guard below still fails closed when the complete chart cannot fit.
   for(const panel of chartsForSection(input,chartSection,safeAssessment as AuditReportInput["assessment"])){
    const evidenceErrors=chartEvidenceIntegrityErrors(panel);
    if(evidenceErrors.length)throw new Error("Report chart evidence integrity failed for "+panel.title+": "+evidenceErrors.join("; "));
    const panelHeight=chartPanelHeight(panel.kind,panel.rows,W-2*M),panelTop=chartCursor;
    if(panelTop-panelHeight<76)throw new Error("Evidence charts cannot fit safely on "+spec.title);
    drawChartPanel(page,{...panel,fixture:rec(input.evidence).fixture===true,y:panelTop,width:W-2*M},fonts.regular,fonts.bold);
    chartCursor=panelTop-panelHeight-12;
   }
  }
  drawFooter(page,"Reson8 A&R Audit",input.auditId,index+1,total,fonts);
  // Yield between pages so the job timeout and lease heartbeat can run. Chart
  // input is bounded before drawing, keeping each synchronous page slice finite.
  await yieldRenderTurn(signal);
 }
 assertRenderActive(signal);
 return pdf.save();
}