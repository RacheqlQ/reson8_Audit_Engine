import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { buildArNotesDecisionContext, chartsForSection, metadataFieldStatus, metadataFieldSource, type AuditReportInput, type AuditReportTier } from "../generate-audit-report.js";
import { loadReportFonts } from "../fonts.js";
import { chartEvidenceIntegrityErrors, chartPanelHeight, countEvidenceLayers, drawChartPanel } from "../charts.js";
import { adaptReportV2, type ReportV2Data } from "./adapters.js";
import { hasReportableKeyCandidates } from "../evidence-guardrails.js";
import { sanitizeAssessmentForEvidence } from "../evidence-guardrails.js";
import { sanitizePublicReportLines, sanitizePublicReportLine } from "./public-language.js";

const W=595.28,H=841.89,M=42;
const C={
 paper:rgb(247/255,243/255,236/255),white:rgb(1,1,1),ink:rgb(43/255,40/255,37/255),
 muted:rgb(108/255,101/255,92/255),line:rgb(226/255,219/255,207/255),
 charcoal:rgb(43/255,40/255,37/255),gold:rgb(176/255,141/255,87/255),
 teal:rgb(29/255,158/255,117/255),amber:rgb(239/255,159/255,39/255),coral:rgb(216/255,90/255,48/255)
};
type Fonts={regular:PDFFont;bold:PDFFont;italic:PDFFont;boldItalic:PDFFont};
type Block={label:string;value:string;provenance?:string;confidence?:string;color?:keyof typeof C};
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
export function buildRecordingOverviewKeyLabel(data:ReportV2Data):string{
 if(data.key.value!==null)return String(data.key.value);
 const resolution=data.tonalResolution;
 if(resolution?.status==="PROVISIONAL"&&resolution.tonic&&resolution.mode)
  return "Provisional: "+resolution.tonic+" "+resolution.mode;
 if(resolution?.status==="UNAVAILABLE")return "Unavailable";
 return "Not determined";
}
export function buildCoverKeyLabel(input:AuditReportInput,data:ReportV2Data):string{
 if(data.key.value!==null)return String(data.key.value);
 const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
 const resolution=rec(input.tonalResolution??harmonic.tonalResolution??rec(input.sonicDna).tonalResolution);
 const tonalAudio={...rec(input.sonicDna),tonalResolution:resolution};
 const candidates=hasReportableKeyCandidates(tonalAudio)
  ?(arr(resolution.candidates).length?arr(resolution.candidates):arr(harmonic.topCandidates)).map(value=>rec(value)):[];
 const first=candidates.find(item=>(typeof item.key==="string"&&item.key.trim())||(typeof item.tonic==="string"&&item.tonic.trim()));
 if(first)return "Possible: "+[str(first.key??first.tonic,""),str(first.mode,"")].filter(Boolean).join(" ");
 if(resolution.status==="UNAVAILABLE")return "Unavailable";
 return "Not determined";
}
function metricBlock(data:ReportV2Data,input:AuditReportInput):Block[]{
 const provenance="Measured from the uploaded recording";
 return [
  {label:"TEMPO",value:data.tempo.value===null?"Not determined":data.tempo.value+" BPM",confidence:undefined,provenance},
  {label:"SONG KEY",value:buildCoverKeyLabel(input,data),confidence:undefined,provenance},
  {label:"PLAYBACK LEVEL",value:data.energy.value===null?"Not measured":String(data.energy.value),confidence:undefined,provenance}
 ];
}
function scoreChip(page:PDFPage,x:number,y:number,width:number,label:string,value:string,color:typeof C.teal,fonts:Fonts){
 page.drawRectangle({x,y,width,height:48,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawCircle({x:x+13,y:y+31,size:3.5,color});
 page.drawText(label.toUpperCase(),{x:x+24,y:y+28,size:6.5,font:fonts.bold,color:C.muted});
 drawWrapped(page,value,x+12,y+15,width-24,fonts.bold,8.2,color,10);
}
function card(page:PDFPage,x:number,top:number,width:number,title:string,body:string[],fonts:Fonts,opts:{accent?:typeof C.teal;height?:number;provenance?:string}={}):number{
 const pad=12,titleH=14,bodyW=width-pad*2;let bodyHeight=0;
 const chunks=body.map(t=>wrap(t,fonts.regular,8.4,bodyW));
 bodyHeight=chunks.reduce((n,lines)=>n+lines.length*11+5,0);
 const provenance=opts.provenance?wrap(opts.provenance,fonts.italic,7,bodyW):[];
 const height=Math.max(opts.height??0,pad+titleH+bodyHeight+(provenance.length?provenance.length*9+6:0)+pad);
 const y=top-height;
 page.drawRectangle({x,y,width,height,color:C.white,borderColor:C.line,borderWidth:.65});
 page.drawRectangle({x,y:y+height-3,width,height:3,color:opts.accent??C.gold});
 page.drawText(title.toUpperCase(),{x:x+pad,y:top-pad-8,size:7,font:fonts.bold,color:opts.accent??C.gold});
 let cy=top-pad-titleH-4;
 for(const lines of chunks){for(const line of lines){page.drawText(line,{x:x+pad,y:cy,size:8.4,font:fonts.regular,color:C.ink});cy-=11;}cy-=5;}
 for(const line of provenance){page.drawText(line,{x:x+pad,y:cy,size:7,font:fonts.italic,color:C.muted});cy-=9;}
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
 const rhythm=rec(rec(input.sonicDna).rhythmFeatures);
 const lines:string[]=[];
 const candidates=arr(rhythm.candidateScores).map(value=>rec(value))
  .filter(item=>finite(item.bpm)&&item.bpm>=40&&item.bpm<=220)
  .slice(0,4).map(item=>String(item.bpm)+" BPM");
 if(candidates.length)lines.push("Possible tempo readings: "+candidates.join("; ")+". Treat these as provisional until confirmed by listening.");
 else if(Array.isArray(rhythm.candidateBpms)) {
  const fallback= rhythm.candidateBpms.filter(value=>finite(value)&&value>=40&&value<=220).slice(0,4);
  if(fallback.length)lines.push("Possible tempo readings: "+fallback.join("; ")+" BPM. Treat these as provisional until confirmed by listening.");
 }
 if(finite(rhythm.alternateTempo)&&rhythm.alternateTempo>=40&&rhythm.alternateTempo<=220)lines.push("Alternative pulse reading: "+Number(rhythm.alternateTempo).toFixed(1)+" BPM.");
 const consensus=rec(rhythm.windowConsensus);
 if(finite(consensus.observedAgreement))lines.push(consensus.observedAgreement>=0.7
  ?"Tempo readings are broadly consistent across the analyzed sections."
  :"Tempo readings vary across the analyzed sections; no single tempo is confirmed.");
 if(arr(rhythm.beatTimesSeconds).length)lines.push("A tentative beat guide is available; confirm the beat placement by listening.");
 const abstention=str(rhythm.abstentionReason,"");
 if(abstention&&abstention!=="Not supplied")lines.push("Tempo not confirmed: "+abstention);
 return lines.length?lines:["No tempo result is available from the supplied recording."];
}
export function buildKeyDiagnosticLines(input: AuditReportInput): string[] {
 const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
 const resolution=rec(input.tonalResolution??harmonic.tonalResolution??rec(input.sonicDna).tonalResolution);
 const tonalAudio={...rec(input.sonicDna),tonalResolution:resolution};
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
 const firstGap=arr(assessment.evidenceGaps).map(value=>str(value,"")).find(Boolean)??"";
 return "Recommended next step: "+(recommendation||firstGap||"Not supplied");
}

export function buildReleaseFramingLine(input: AuditReportInput): string {
 const release=Date.parse(String(rec(input.evidence).releaseDate??""));
 const generated=Date.parse(String(input.generatedAt??""));
 return Number.isFinite(release)&&Number.isFinite(generated)&&release<generated
  ? "Post-release framing: release date is in the past."
  : "Release framing: date does not establish a past release.";
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

export function buildPositioningLines(input: AuditReportInput): string[] {
 const evidence = rec(input.evidence), assessment = sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),rec(input.evidence));
 const lines: string[] = [];
 const genre = str(evidence.genre, "");
 const genreSource = str(evidence.genreSource ?? evidence.genreProvider ?? evidence.genreProvenance, "");
 if (genre) {
  lines.push(genreSource
   ? "Primary lane: " + genre + " [Provider-backed · " + genreSource + "]"
   : "Genre candidate: " + genre + " [Hypothesis · provider provenance not supplied]");
 }
 const hypotheses = arr(assessment.laneHypotheses).map(value => str(value, "")).filter(Boolean);
 const adjacent = arr(assessment.adjacentLanes).map(value => str(value, "")).filter(Boolean);
 if (hypotheses.length) lines.push("Related styles to review: " + hypotheses.join("; "));
 if (adjacent.length) lines.push("Other styles to consider: " + adjacent.join("; "));
 if (!lines.length) {
  lines.push("Genre positioning is not established because no music-platform genre listing or verified comparable artists were supplied.");
  lines.push("What is needed: a music-platform genre listing and verified comparable artists or recordings.");
  lines.push("Decision boundary: sonic descriptors alone do not establish audience overlap, music-platform fit, commercial reach or market demand.");
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
  const status=conflict?"Conflict":releaseDifference?"Release variant":fieldStatus.startsWith("Available")&&source!=="unavailable"?"Source-returned":identityStatusLabel(fieldStatus);
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
  const values=[row.field,row.value,row.status,row.source],colors=[C.ink,C.ink,row.status==="Conflict"?C.coral:row.status==="Release variant"||row.status==="Hypothesis"?C.amber:row.status==="Cross-checked"?C.teal:row.status==="Unavailable"?C.muted:C.ink,C.muted];
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
 const summaryHeight=card(page,M,summaryTop,width,"Provider lookup and reconciliation context",[
  "Sources checked: "+checked,
  "Provider responses: "+providers,
  "Platform coverage: "+str(e.platformCoverage,"Not supplied"),
  "Recording identity conflicts remain blocking; album, UPC, label and date differences are shown as release variants."
 ],fonts,{accent:C.gold});
 return summaryTop-summaryHeight-14;
}
function buildReportSections(input:AuditReportInput,data:ReportV2Data,tier:AuditReportTier):PageSpec[]{
 const e=rec(input.evidence),a=sanitizeAssessmentForEvidence(rec(input.assessment),rec(input.sonicDna),rec(input.evidence)),sonic=rec(input.sonicDna);
 const notesContext=buildArNotesDecisionContext(input);
 const pages:PageSpec[]=[
  {title:"Cover and verdict",kind:"cover",blocks:metricBlock(data,input),lines:[
   "Artist: "+str(e.artist)+"   Track: "+str(e.title),
   "Audit date: "+dateText(input.generatedAt)+"   Release date: "+dateText(e.releaseDate),
   "Executive summary: "+str(a.executiveSummary,"No executive summary supplied."),
   buildNextActionLine(input)
  ]},
  {title:"Identity and source reconciliation",kind:"identity",blocks:[]},
  {title:"Track snapshot",kind:"snapshot",blocks:metricBlock(data,input),lines:[
   ...(data.structure?["STRUCTURE — "+data.structure.map(s=>s.index+". "+s.label+" ("+s.startSeconds+"–"+s.endSeconds+"s)").join(" | ")]:[]),
   ...(data.energySeries?["ENERGY SERIES — "+data.energySeries.length+" timestamped points; peak/dip derived from supplied series."]:[]),
   ...(data.sonicAxes?["SONIC DNA AXES — "+Object.entries(data.sonicAxes).map(([name,axis])=>name+" "+axis.value+"/100"+(axis.note?" ("+axis.note+")":"")).join("; ")]:[])
  ]},
  {title:"Evidence ledger and scorecard",blocks:[],lines:[
   buildEvidenceLedgerSummary(arr(a.evidenceLabels).map(value => rec(value) as { label: string })),
   "Headline score: "+(data.headlineScore===null?"N/D — no scored headline value supplied":data.headlineScore+"/100"),
   ...(data.scoreDrivers??[]).map(d=>d.label+": "+d.score+"/100"+(d.weight===null?"":" · weight "+d.weight)+" · "+(d.evidence||"Evidence note not supplied")),
   "Market evidence: "+(data.hasVerifiedCommercialEvidence?"Source-attributed commercial data supplied":"Insufficient — no verified commercial source data supplied."),
   ...data.decisionDimensions.map(dimension=>dimension.name+" verdict: "+dimension.status+" — "+dimension.basis),
   ...(data.comparables??[]).map(c=>"Comparable context (not audience overlap): "+c.title+" · "+c.year+" · "+c.lane+" · "+c.similarity+"% · "+c.basis+" · "+c.source)
  ]},
  {title:"A&R positioning",blocks:[],lines:buildPositioningLines(input)},
  {title:"Strengths, risks and actions",blocks:[],lines:[
   "Strengths: "+arr(a.strengths).map(v=>str(v)).join("; ")||"No measured strengths supplied.",
   "Risks: "+arr(a.risks).map(v=>str(v)).join("; ")||"No evidenced risks supplied.",
   "Priorities: "+arr(rec(a.releaseStrategy).priorities).map(v=>str(v)).join("; ")||"No priorities supplied.",
   "Readiness: "+str(a.releaseReadiness,"Pending — no supplied readiness evidence."),
   ...(data.moments??[]).map(m=>"Flagged moment "+m.timestampSeconds.toFixed(2)+"s · "+m.tag+" · "+m.title+" — "+m.note)
  ]},
  {title:"Release and promotion plan",blocks:[],lines:[
   buildReleaseFramingLine(input),
   "General guidance: "+str(a.industryPractice,"No industry guidance supplied."),
   "Content concepts: "+arr(rec(a.promotionPlan).contentIdeas).map(v=>str(v)).join("; "),
   "Playlist categories to investigate: "+arr(rec(a.promotionPlan).playlistCategories).map(v=>str(v)).join("; "),
   ...buildPlaylistProviderStatusLines(input),
   ...(e.label||e.partner?["Supplied label / partner: "+str(e.label??e.partner)]:[])
  ]},
  {title:"Human listening checklist and A&R notes",blocks:[],lines:arr(a.humanListeningChecklist).map(v=>str(v,"")).filter(v=>v&&!/^not supplied$/i.test(v)).map(v=>"[ ] "+v).concat([notesContext.verdict,notesContext.summary,...notesContext.prompts.map(prompt=>"Review prompt: "+prompt),"Use the notes area to record the A&R review."])},
  {title:"Evidence and limitations",kind:"limitations",blocks:[],lines:[
   ...sanitizePublicReportLines(data.notYetMeasured),
   ...publicReportLimitations(a.limitations),
   "Only details supported by the supplied recording or named music platforms are presented as confirmed.",
   "A listening review is still required before final release or mastering decisions."
  ]}
 ];
 if(tier==="full"){
  pages.push(
   {title:"Sonic DNA dashboard",blocks:[],kind:"full-axes"},
   {title:"Tempo and energy spectrum",blocks:[],kind:"tempo-energy"},
   {title:"Scorecard, execution timeline and loudness",blocks:[],kind:"full-depth"}
  );
 }
 return pages;
}

function drawMetricCard(page:PDFPage,x:number,top:number,width:number,block:Block,fonts:Fonts):number{
 const pad=12,valueLines=wrap(block.value,fonts.bold,14,width-pad*2);
 const provenanceLines=wrap(block.provenance??"From uploaded recording",fonts.regular,7,width-pad*2);
 const valueBottom=top-43-Math.max(0,valueLines.length-1)*17;
 const provenanceTop=valueBottom-17;
 const height=Math.max(104,top-(provenanceTop-Math.max(0,provenanceLines.length-1)*9)+pad);
 const y=top-height;
 page.drawRectangle({x,y,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:y+height-3,width,height:3,color:C.gold});
 page.drawText(block.label,{x:x+pad,y:top-17,size:7,font:fonts.bold,color:C.muted});
 valueLines.forEach((line,index)=>page.drawText(line,{x:x+pad,y:top-43-index*17,size:14,font:fonts.bold,color:C.ink}));
 provenanceLines.forEach((line,index)=>page.drawText(line,{x:x+pad,y:provenanceTop-index*9,size:7,font:fonts.regular,color:C.muted}));
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
 const x=M,width=W-2*M,height=154,bottom=top-height;
 page.drawRectangle({x,y:bottom,width,height,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawRectangle({x,y:top-3,width,height:3,color:C.gold});
 page.drawText("CIRCLE OF FIFTHS · SONG KEY MAP",{x:x+12,y:top-17,size:7,font:fonts.bold,color:C.gold});
 const order=["C","G","D","A","E","B","F#","C#","G#","D#","A#","F"];
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
  page.drawCircle({x:px,y:py,size:11,color:fill,borderColor:isConfirmed?C.teal:isCandidate?C.amber:C.line,borderWidth:1});
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
  page.drawRectangle({x:x+145,y:y-2,width:210*Math.max(0,Math.min(100,axis.value))/100,height:6,color:axis.value<60?C.amber:C.teal});
  page.drawText(String(axis.value),{x:x+365,y:y-1,size:6.7,font:fonts.bold,color:C.ink});
 });
 return height;
}
function drawSnapshot(page:PDFPage,data:ReportV2Data,fonts:Fonts,input:AuditReportInput){
 const blocks=metricBlock(data,input),gap=10,width=(W-2*M-gap*2)/3,top=H-92;
 const metricHeight=Math.max(...blocks.map((b,i)=>drawMetricCard(page,M+i*(width+gap),top,width,b,fonts)));
 let y=top-metricHeight-12;
 const keyMapHeight=drawCircleOfFifths(page,input,data,fonts,y);
 y-=keyMapHeight+12;
 if(data.structure){
  const height=116;card(page,M,y,W-2*M,"Structure",[],fonts,{height,accent:C.gold});
  const left=M+14,barY=y-63,barW=W-2*M-28,total=Math.max(...data.structure.map(s=>s.endSeconds));
  const palette=[C.teal,C.gold,C.amber,C.coral];
  page.drawText("TRACK STRUCTURE · ELAPSED TIME",{x:left,y:barY+25,size:6,font:fonts.bold,color:C.muted});
  data.structure.forEach((s,i)=>{const x=left+(s.startSeconds/total)*barW,w=barW*(s.endSeconds-s.startSeconds)/total;page.drawRectangle({x,y:barY,width:w,height:18,color:palette[i%palette.length]});page.drawText(String(s.index),{x:x+w/2-2,y:barY+5,size:6,font:fonts.bold,color:C.white});});
  page.drawText("0s",{x:left,y:barY-12,size:6,font:fonts.regular,color:C.muted});
  page.drawText(total.toFixed(0)+"s",{x:left+barW-18,y:barY-12,size:6,font:fonts.regular,color:C.muted});
  let lineY=barY-28;data.structure.forEach((s,i)=>{const label=s.index+" · "+s.label+"  "+s.startSeconds.toFixed(1)+"–"+s.endSeconds.toFixed(1)+"s";const col=i%2;drawWrapped(page,label,M+14+col*250,lineY-Math.floor(i/2)*12,238,fonts.regular,6.7,C.muted,8);});
  y-=height+14;
 }
 if(data.energySeries){
  const h=178,topY=y;page.drawRectangle({x:M,y:topY-h,width:W-2*M,height:h,color:C.white,borderColor:C.line,borderWidth:.7});
  page.drawText("ENERGY THROUGH THE TRACK",{x:M+12,y:topY-16,size:7,font:fonts.bold,color:C.gold});
  page.drawText("Relative level",{x:M+12,y:topY-29,size:6,font:fonts.italic,color:C.muted});
  page.drawText("Track time",{x:W-M-126,y:topY-h+8,size:6,font:fonts.italic,color:C.muted});
  const left=M+28,right=W-M-16,plotTop=topY-42,plotBottom=topY-h+32;
  const vals=data.energySeries.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  for(let g=0;g<=4;g++){const gy=plotBottom+(plotTop-plotBottom)*g/4;page.drawLine({start:{x:left,y:gy},end:{x:right,y:gy},color:C.line,thickness:.5});}
  const t0=data.energySeries[0].timeSeconds,t1=data.energySeries[data.energySeries.length-1].timeSeconds,dt=t1-t0||1;
  for(let i=1;i<data.energySeries.length;i++){const a=data.energySeries[i-1],b=data.energySeries[i];page.drawLine({start:{x:left+(a.timeSeconds-t0)/dt*(right-left),y:plotBottom+(a.value-min)/span*(plotTop-plotBottom)},end:{x:left+(b.timeSeconds-t0)/dt*(right-left),y:plotBottom+(b.value-min)/span*(plotTop-plotBottom)},color:C.teal,thickness:2.2});}
  const peak=data.energySeries.reduce((a,b)=>b.value>a.value?b:a),dip=data.energySeries.reduce((a,b)=>b.value<a.value?b:a);
  page.drawCircle({x:left+(peak.timeSeconds-t0)/dt*(right-left),y:plotBottom+(peak.value-min)/span*(plotTop-plotBottom),size:4,color:C.teal});
  page.drawCircle({x:left+(dip.timeSeconds-t0)/dt*(right-left),y:plotBottom+(dip.value-min)/span*(plotTop-plotBottom),size:4,color:C.coral});
  const peakX=left+(peak.timeSeconds-t0)/dt*(right-left),dipX=left+(dip.timeSeconds-t0)/dt*(right-left);
  const peakLabelX=Math.max(left,Math.min(right-42,peakX-21)),dipLabelX=Math.max(left,Math.min(right-38,dipX-19));
  const sameRegion=Math.abs(peakLabelX-dipLabelX)<46;
  page.drawText("Peak "+peak.timeSeconds.toFixed(1)+"s",{x:peakLabelX,y:plotBottom-13,size:6,font:fonts.bold,color:C.teal});
  page.drawText("Dip "+dip.timeSeconds.toFixed(1)+"s",{x:dipLabelX,y:plotBottom-(sameRegion?24:13),size:6,font:fonts.bold,color:C.coral});
  y-=h+12;
 }
 const sonic=rec(input.sonicDna);
 const rows:Array<[string,string]>=[
  ["Track length",typeof sonic.durationSeconds==="number"&&Number.isFinite(sonic.durationSeconds)?Math.floor(sonic.durationSeconds/60)+" min "+Math.round(sonic.durationSeconds%60)+" sec":""],
  ["Format",typeof sonic.channels==="number"?(sonic.channels===2?"Stereo":sonic.channels===1?"Mono":sonic.channels+" channels"):""],
  ["Song key",buildRecordingOverviewKeyLabel(data)],
  ["Tempo",data.tempo.value===null?"Not determined":data.tempo.value+" BPM"]
 ].filter((entry):entry is [string,string]=>Boolean(entry[1]));
 if(rows.length){
  const panelHeight=38+Math.ceil(rows.length/2)*23+14,top=y-8,bottom=top-panelHeight;
  if(bottom>=72){
   page.drawRectangle({x:M,y:bottom,width:W-2*M,height:panelHeight,color:C.white,borderColor:C.line,borderWidth:.7});
   page.drawText("RECORDING OVERVIEW",{x:M+12,y:top-16,size:7,font:fonts.bold,color:C.gold});
   rows.forEach(([label,value],index)=>{
    const col=index%2,row=Math.floor(index/2),x=M+12+col*250,yy=top-34-row*23;
    page.drawText(label,{x,y:yy,size:6.4,font:fonts.regular,color:C.muted});
    drawWrapped(page,value,x+112,yy,120,fonts.bold,6.4,C.ink,7);
   });
   page.drawText("Uploaded-master descriptors only; no mastering-readiness or audience conclusion is implied.",{x:M+12,y:bottom+6,size:5.8,font:fonts.italic,color:C.muted});
   y=bottom-12;
  }
 }
}
function drawSonicAxes(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const axes=data.sonicAxes!;const names=Object.keys(axes) as Array<keyof typeof axes>,cx=170,cy=555,r=118;
 for(let ring=1;ring<=4;ring++){const rr=r*ring/4;for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5,b=-Math.PI/2+(i+1)*2*Math.PI/5;page.drawLine({start:{x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr},end:{x:cx+Math.cos(b)*rr,y:cy+Math.sin(b)*rr},color:C.line,thickness:.6});}}
 const pts=names.map((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5,v=axes[name].value/100;return {x:cx+Math.cos(a)*r*v,y:cy+Math.sin(a)*r*v};});
 pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];page.drawLine({start:p,end:q,color:C.teal,thickness:2.2});page.drawCircle({x:p.x,y:p.y,size:4,color:C.teal});});
 names.forEach((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;const x=cx+Math.cos(a)*(r+22),y=cy+Math.sin(a)*(r+22);page.drawText(name+" "+axes[name].value,{x:x-28,y,size:7,font:fonts.bold,color:C.ink});});
 const note="Supplied axis scores only. Scale: 0–100; higher values indicate a higher score on that named axis. No reference average or audience-overlap claim is implied.";
 drawWrapped(page,note,330,cy+60,180,fonts.regular,8,C.muted,11);

 let y=cy-155;
 names.forEach(name=>{const item=axes[name];page.drawRectangle({x:M,y:y-15,width:W-2*M,height:38,color:C.white,borderColor:C.line,borderWidth:.6});page.drawText(name,{x:M+12,y:y+8,size:8,font:fonts.bold,color:C.ink});page.drawRectangle({x:M+112,y:y+5,width:150,height:6,color:C.line});page.drawRectangle({x:M+112,y:y+5,width:150*item.value/100,height:6,color:item.value<60?C.amber:C.teal});page.drawText(String(item.value),{x:M+270,y:y+5,size:8,font:fonts.bold,color:C.ink});drawWrapped(page,item.note??"Axis note not supplied.",M+310,y+8,190,fonts.regular,7,C.muted,9);y-=45;});
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
  const barX=M+14,barY=y-52,barW=W-2*M-28;page.drawRectangle({x:barX,y:barY,width:barW,height:12,color:C.line});page.drawRectangle({x:barX,y:barY,width:barW*score/100,height:12,color:C.teal});page.drawCircle({x:barX+barW*score/100,y:barY+6,size:7,color:C.white,borderColor:C.ink,borderWidth:1});y-=105;
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
 moments.forEach((m,i)=>{const x=left+(m.timestampSeconds/max)*(right-left);const color=m.tag==="Risk"?C.coral:m.tag==="Check"?C.amber:C.teal;page.drawLine({start:{x,y:mid-23},end:{x,y:mid+24},color,thickness:1.6});page.drawCircle({x,y:mid+26,size:8,color});page.drawText(String(i+1),{x:x-2.5,y:mid+23,size:6,font:fonts.bold,color:C.white});page.drawText(m.timestampSeconds.toFixed(1)+"s",{x:x-14,y:mid-34-(i%2)*9,size:6,font:fonts.bold,color});});
 page.drawCircle({x:M+17,y:mid-9,size:2.5,color:C.teal});page.drawText("Strength",{x:M+24,y:mid-12,size:6.5,font:fonts.bold,color:C.teal});
 page.drawCircle({x:M+98,y:mid-9,size:2.5,color:C.amber});page.drawText("Check",{x:M+105,y:mid-12,size:6.5,font:fonts.bold,color:C.amber});
 page.drawCircle({x:M+164,y:mid-9,size:2.5,color:C.coral});page.drawText("Risk",{x:M+171,y:mid-12,size:6.5,font:fonts.bold,color:C.coral});
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
export async function generateAuditReportV2(source:AuditReportInput,tier:AuditReportTier="sample"):Promise<Uint8Array>{
 const input:AuditReportInput={...source,assessment:sanitizeAssessmentForEvidence(rec(source.assessment),rec(source.sonicDna),rec(source.evidence)) as AuditReportInput["assessment"]};
 const data=adaptReportV2(input),pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf);
 const pages=buildReportSections(input,data,tier).map(spec=>({...spec,lines:sanitizePublicReportLines(spec.lines??[]),blocks:spec.blocks.map(block=>({...block,value:sanitizePublicReportLine(block.value),provenance:sanitizePublicReportLine(block.provenance??"")||"From uploaded recording",confidence:undefined}))})),total=tier==="full"?12:9;
 if(pages.length!==total)throw new Error("Report section configuration does not match the approved "+tier+" page allocation.");
 for(let index=0;index<pages.length;index++){
  const spec=pages[index],page=pageBase(pdf,tier==="full"&&index===0?"Full A&R report":spec.title,fonts);
  let chartCursor=H-380;
  if(spec.kind==="identity"){
   chartCursor=drawIdentityReconciliation(page,input,fonts);
  }else if(spec.kind==="snapshot"){
   drawSnapshot(page,data,fonts,input);
  }else if(spec.kind==="limitations"){
   const body=spec.lines?.filter(Boolean)??[];
   const height=card(page,M,H-92,W-2*M,spec.title,body,fonts,{accent:C.gold});
   const mapTop=H-92-height-14;
   const mapHeight=drawCircleOfFifths(page,input,data,fonts,mapTop);
   if(data.sonicAxes)drawCompactSonicAxes(page,data,fonts,mapTop-mapHeight-12);
  }else if(spec.kind==="full-axes"){
   if(data.sonicAxes)drawSonicAxes(page,data,fonts);
   else card(page,M,H-105,W-2*M,"Sonic DNA dashboard",data.notYetMeasured.filter(value=>/Sonic DNA/i.test(value)).length?data.notYetMeasured.filter(value=>/Sonic DNA/i.test(value)):["NOT MEASURED: all five source-backed Sonic DNA axes are not present."],fonts,{accent:C.amber});
  }else if(spec.kind==="tempo-energy"){
   const tempoLines=[data.tempo.value===null
    ?"Tempo not confirmed from the recording."
    :"Measured tempo: "+data.tempo.value+" BPM."];
   card(page,M,H-105,W-2*M,"Tempo",tempoLines,fonts,{accent:data.tempo.value===null?C.amber:C.teal});
   const harmonic=rec(rec(input.sonicDna).harmonicFeatures);
   const candidates=(hasReportableKeyCandidates(rec(input.sonicDna))?arr(harmonic.topCandidates):[]).map(value=>rec(value))
    .map(item=>[str(item.key,""),str(item.mode,"")].filter(Boolean).join(" ")).filter(Boolean).slice(0,4);
   const keyLines=[data.key.value!==null
    ?"Confirmed song key: "+String(data.key.value)+"."
    :candidates.length?"Song key not confirmed. Possible tonal centres: "+candidates.join(", ")+"."
    :"Song key not determined from the recording."];
   card(page,M,H-245,W-2*M,"Song key",keyLines,fonts,{accent:data.key.value===null?C.amber:C.teal});
   const energy=data.energy.value===null?"Playback level was not measured.":"Playback level measurements are available from the uploaded recording.";
   card(page,M,H-385,W-2*M,"Playback level", [energy],fonts,{accent:data.energy.value===null?C.amber:C.teal});
   if(data.energySeries){
    const top=H-540,height=220,left=M+28,right=W-M-18,bottom=top-height+32;
    page.drawRectangle({x:M,y:top-height,width:W-2*M,height,color:C.white,borderColor:C.line,borderWidth:.7});
    page.drawText("ENERGY SPECTRUM · SOURCE VALUES",{x:M+12,y:top-17,size:7,font:fonts.bold,color:C.gold});
    const values=data.energySeries.map(point=>point.value),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
    const t0=data.energySeries[0].timeSeconds,t1=data.energySeries[data.energySeries.length-1].timeSeconds,dt=t1-t0||1;
    for(let i=1;i<data.energySeries.length;i++){
     const a=data.energySeries[i-1],b=data.energySeries[i];
     page.drawLine({start:{x:left+(a.timeSeconds-t0)/dt*(right-left),y:bottom+(a.value-min)/span*(top-48-bottom)},end:{x:left+(b.timeSeconds-t0)/dt*(right-left),y:bottom+(b.value-min)/span*(top-48-bottom)},color:C.teal,thickness:2});
    }
    page.drawText("Elapsed "+t0.toFixed(1)+"–"+t1.toFixed(1)+" s",{x:left,y:bottom-15,size:6,font:fonts.regular,color:C.muted});
   }else card(page,M,H-540,W-2*M,"Energy spectrum · Not measured",["NOT MEASURED: no valid timestamped energy series was supplied."],fonts,{accent:C.amber});
  }else if(spec.kind==="full-depth"){
   const assessment=rec(input.assessment),release=rec(assessment.releaseStrategy);
   const scoreLines=data.headlineScore===null?["NOT MEASURED: no validated headline score was supplied.",...(data.scoreDrivers??[]).map(driver=>driver.label+": "+driver.score+"/100 · "+(driver.evidence||"Evidence note not supplied"))]:["Supplied assessment score: "+data.headlineScore+"/100",...(data.scoreDrivers??[]).map(driver=>driver.label+": "+driver.score+"/100 · "+(driver.evidence||"Evidence note not supplied"))];
   card(page,M,H-105,W-2*M,"Evidence scorecard",scoreLines,fonts,{accent:C.gold});
   const rawTimeline=Array.isArray(release.executionTimeline)?release.executionTimeline:Array.isArray(assessment.executionTimeline)?assessment.executionTimeline:[];
   const timelineLines=rawTimeline.map(value=>{const row=rec(value);return [str(row.label??row.phase??row.title,""),str(row.timing??row.when??row.window,""),str(row.action??row.description??row.task,"")].filter(value=>value&&value!=="Not supplied").join(" · ");}).filter(Boolean);
   card(page,M,H-245,W-2*M,"Execution timeline · PLAN",timelineLines.length?["ILLUSTRATIVE PLAN — proposed guidance, not a verified campaign outcome.",...timelineLines]:["NOT SUPPLIED: no execution timeline was included in the persisted assessment."],fonts,{accent:C.amber});
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
    page.drawCircle({x:ringX,y:ringY,size:43,color:C.paper,borderColor:C.line,borderWidth:9});
    page.drawCircle({x:ringX,y:ringY,size:43,color:C.white,borderColor:C.teal,borderWidth:7});
    page.drawText(String(data.headlineScore),{x:ringX-18,y:ringY-7,size:19,font:fonts.bold,color:C.ink});
    page.drawText("SCORE",{x:ringX-13,y:ringY-21,size:6,font:fonts.bold,color:C.teal});
    page.drawText("SCORE DRIVERS",{x:M+145,y:H-315,size:7,font:fonts.bold,color:C.muted});
    const drivers=data.scoreDrivers??[];
    drivers.forEach((d,i)=>{const yy=H-340-i*23;page.drawText(d.label,{x:M+145,y:yy,size:7,font:fonts.bold,color:C.ink});page.drawRectangle({x:M+245,y:yy-2,width:205,height:7,color:C.line});page.drawRectangle({x:M+245,y:yy-2,width:205*d.score/100,height:7,color:d.score<60?C.amber:C.teal});page.drawText(String(d.score),{x:M+460,y:yy-2,size:7,font:fonts.bold,color:C.ink});});
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
   const toc=pages.slice(1);
   toc.forEach((p,i)=>{const col=i<4?0:1,row=i<4?i:i-4,x=M+col*250,y=142-row*14;page.drawText(String(i+2).padStart(2,"0"),{x,y,size:7,font:fonts.bold,color:C.gold});drawWrapped(page,p.title,x+28,y,205,fonts.regular,7,C.ink,8);});
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
   "Evidence ledger and scorecard":"Evidence ledger and provenance",
   "A&R positioning":"Creative identity and A&R positioning",
   "Strengths, risks and actions":"Strengths and creative leverage",
   "Release and promotion plan":"Promotion plan"
  };
  const chartSection=legacyChartSection[spec.title];
  if(chartSection){
   // Anchor evidence panels to the actual end of the page's content card.
   // The fit guard below still fails closed when the complete chart cannot fit.
   for(const panel of chartsForSection(input,chartSection)){
    const evidenceErrors=chartEvidenceIntegrityErrors(panel);
    if(evidenceErrors.length)throw new Error("Report chart evidence integrity failed for "+panel.title+": "+evidenceErrors.join("; "));
    const panelHeight=chartPanelHeight(panel.kind,panel.rows,W-2*M),panelTop=chartCursor;
    if(panelTop-panelHeight<76)throw new Error("Evidence charts cannot fit safely on "+spec.title);
    drawChartPanel(page,{...panel,fixture:rec(input.evidence).fixture===true,y:panelTop,width:W-2*M},fonts.regular,fonts.bold);
    chartCursor=panelTop-panelHeight-12;
   }
  }
  drawFooter(page,"Reson8 A&R Audit",input.auditId,index+1,total,fonts);
 }
 const form=pdf.getForm(),notes=form.createTextField("ar_notes");notes.enableMultiline();
 const notesPage=pdf.getPages()[tier==="full"?7:Math.max(0,pages.length-2)]??pdf.getPages()[0];
 notes.addToPage(notesPage,{x:M,y:78,width:W-2*M,height:38,borderWidth:.7,borderColor:C.gold,backgroundColor:C.white});
 notes.setFontSize(8);notes.updateAppearances(fonts.regular);
 return pdf.save();
}
