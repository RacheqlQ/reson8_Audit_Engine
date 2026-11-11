import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { ArAssessment } from "../providers/groq/client.js";
import { loadReportFonts } from "./fonts.js";
import { buildStrengthRiskChartRows, chartPanelHeight, chartPanelLayoutErrors, countEvidenceLayers, drawChartPanel, type ChartPanelInput } from "./charts.js";

export type AuditReportTier = "sample" | "full";
export interface AuditReportInput { auditId:string; generatedAt:string; evidence:Record<string,unknown>; sonicDna:Record<string,unknown>|null; assessment:ArAssessment; }
export interface ReportRect { x:number;y:number;width:number;height:number;id:string; }
export interface ReportPagePlan { title:string;text:string[]; }
const W=595.28,H=841.89,M=48,TOP=735,BOTTOM=76,AVAILABLE=TOP-BOTTOM;
const C={navy:rgb(11/255,27/255,58/255),blue:rgb(47/255,107/255,1),violet:rgb(124/255,77/255,1),teal:rgb(31/255,209/255,178/255),coral:rgb(1,107/255,94/255),paper:rgb(247/255,245/255,240/255),ink:rgb(22/255,29/255,43/255),muted:rgb(91/255,101/255,119/255),line:rgb(220/255,222/255,226/255),white:rgb(1,1,1)};
const text=(v:unknown):string=>v===null||v===undefined||v===""?"":Array.isArray(v)?v.map(text).filter(Boolean).join(", "):typeof v==="object"?"":String(v);
const val=(v:unknown,fallback="Not supplied")=>text(v)||fallback;
const chartValue=(v:unknown):string|number|null=>typeof v==="string"||typeof v==="number"&&Number.isFinite(v)?v:null;
function wrap(value:string,font:PDFFont,size:number,width:number):string[]{
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
export function checkPageDensity(rects:ReportRect[],exempt=false):{ok:boolean;emptyRatio:number}{
 if(exempt||rects.length===0)return {ok:true,emptyRatio:0};
 const top=Math.max(...rects.map(r=>r.y+r.height)),bottom=Math.min(...rects.map(r=>r.y));
 const occupied=Math.max(0,Math.min(AVAILABLE,top-bottom));
 const ratio=Math.max(0,Math.min(1,1-occupied/AVAILABLE));
 return {ok:ratio<=.35,emptyRatio:ratio};
}
function header(page:PDFPage,title:string,n:number,f:{regular:PDFFont;bold:PDFFont},accent=C.blue){page.drawRectangle({x:0,y:H-7,width:W,height:7,color:accent});page.drawText("RESON8 / A&R INTELLIGENCE",{x:M,y:H-34,size:8,font:f.bold,color:C.navy});page.drawText(title.toUpperCase(),{x:M,y:H-58,size:7,font:f.bold,color:accent});page.drawLine({start:{x:M,y:H-68},end:{x:W-M,y:H-68},color:C.line,thickness:.7});page.drawLine({start:{x:M,y:43},end:{x:W-M,y:43},color:C.line,thickness:.7});page.drawText("CONFIDENTIAL • EVIDENCE-LED ASSESSMENT",{x:M,y:28,size:6.5,font:f.regular,color:C.muted});page.drawText(String(n).padStart(2,"0"),{x:W-M-18,y:27,size:8,font:f.bold,color:C.navy});}
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
 if(titleY<365)throw new Error("Cover identity text exceeds its allocated area");
 p.drawRectangle({x:M,y:250,width:W-2*M,height:104,color:C.navy});
 p.drawText("ASSESSMENT VERDICT",{x:M+18,y:326,size:7,font:f.bold,color:C.teal});add("cover-verdict-label",M+18,323,130,9);
 p.drawText(verdictLabel(val(input.assessment.commercialRead.marketability,"undetermined")).toUpperCase(),{x:M+18,y:292,size:15,font:f.bold,color:C.white});add("cover-verdict",M+18,289,180,22);
 p.drawText("CONFIDENCE",{x:W-M-116,y:326,size:7,font:f.bold,color:C.teal});add("cover-confidence-label",W-M-116,323,80,9);
 const cx=W-M-72,cy=290;p.drawCircle({x:cx,y:cy,size:25,borderColor:C.muted,borderWidth:5});p.drawCircle({x:cx,y:cy,size:20,borderColor:C.teal,borderWidth:2});
 p.drawText(Math.round(input.assessment.confidence*100)+"%",{x:cx-13,y:cy-3,size:9,font:f.bold,color:C.white});add("cover-confidence-value",cx-14,cy-6,30,12);
 const dateLines=wrap("Generated "+input.generatedAt.slice(0,10)+" • Version "+input.assessment.assessmentVersion,f.regular,8,W-2*M);
 let dateY=210;for(let n=0;n<dateLines.length;n++){p.drawText(dateLines[n],{x:M,y:dateY,size:8,font:f.regular,color:C.muted});add("cover-date-version-"+n,M,dateY-2,W-2*M,11);dateY-=12;}
 const auditLines=wrap("Audit "+input.auditId,f.regular,7,W-2*M);
 let auditY=dateY-3;for(let n=0;n<auditLines.length;n++){p.drawText(auditLines[n],{x:M,y:auditY,size:7,font:f.regular,color:C.muted});add("cover-audit-id-"+n,M,auditY-2,W-2*M,10);auditY-=11;}
 if(input.evidence.fixture===true){p.drawText("FIXTURE — NOT A REAL ANALYSIS",{x:M,y:70,size:8,font:f.bold,color:C.coral});add("cover-fixture-label",M,67,230,10);}
 p.drawText("PRIVATE & CONFIDENTIAL",{x:M,y:54,size:7,font:f.bold,color:C.navy});add("cover-confidentiality",M,51,200,9);
 const coverCheck=checkLayout(coverRects);if(!coverCheck.ok)throw new Error(coverCheck.errors.join("; "));
}
interface Section{title:string;accent:"blue"|"violet"|"teal"|"coral";body:string[];}
function verdictLabel(v:string):string{const m:Record<string,string>={high:"Ready to pitch",moderate:"Develop",low:"Needs work",undetermined:"Insufficient evidence"};return m[v.toLowerCase()]??"Insufficient evidence";}
function verdictRule(v:string):string{const m:Record<string,string>={high:"Ready to pitch requires verified commercial-performance evidence, a defined reporting period and a supportable release proposition.",moderate:"Develop applies when evidence supports a credible direction but important execution or positioning work remains.",low:"Needs work applies when supplied evidence identifies material gaps that should be addressed before pitching.",undetermined:"Insufficient evidence applies when source-attributed commercial or release evidence is missing; no demand or partner interest is inferred."};return m[v.toLowerCase()]??m.undetermined;}
function industryPractice(v:string):string{return "INDUSTRY PRACTICE — "+v.replace(/^(?:INDUSTRY PRACTICE\s*[—:-]\s*)+/i,"").trim();}
function chartsForSection(i:AuditReportInput,title:string):ChartPanelInput[]{
 const a=i.assessment,s=i.sonicDna,hasAudio=Boolean(s&&s.provenance==="uploaded_audio_master"),counts=countEvidenceLayers(a.evidenceLabels);
 if(title==="Evidence ledger and provenance")return [{title:"Evidence layers",kind:"layers",rows:[{label:"OBSERVED",value:counts.OBSERVED},{label:"RECOGNIZED",value:counts.RECOGNIZED},{label:"RECONCILED",value:counts.RECONCILED},{label:"INFERRED",value:counts.INFERRED}],shows:"Counts of claims carrying each evidence label in this assessment.",cantShow:"Whether a claim is true, complete or commercially meaningful."}];
 if(title==="Sonic DNA and technical profile")return [
 {title:"Sonic DNA dashboard",kind:"sonic",unavailable:!hasAudio,rows:[{label:"BPM",value:hasAudio?chartValue(s?.bpm):null},{label:"KEY / MODE",value:hasAudio?[text(s?.key),text(s?.mode)].filter(Boolean).join(" ")||null:null},{label:"KEY CONFIDENCE",value:hasAudio&&typeof s?.keyConfidence==="number"?Math.round(s.keyConfidence*100)+"%":null},{label:"LOUDNESS LUFS",value:hasAudio?chartValue(s?.loudnessLufs):null},{label:"DYNAMIC RANGE",value:hasAudio?chartValue(s?.dynamicRangeDb):null},{label:"RMS ENERGY",value:hasAudio?chartValue(s?.rmsEnergy):null}],shows:"Master-derived tempo, key confidence, loudness, dynamic range and RMS fields when an uploaded master exists.",cantShow:"Audience demand, listener response, mastering quality or commercial performance."},
 {title:"Tempo and energy spectrum",kind:"spectrum",unavailable:!hasAudio,rows:[{label:"TEMPO",value:hasAudio?chartValue(s?.bpm):null},{label:"RMS ENERGY",value:hasAudio?chartValue(s?.rmsEnergy):null},{label:"DYNAMIC RANGE",value:hasAudio?chartValue(s?.dynamicRangeDb):null}],shows:"Available master-derived tempo and energy measurements.",cantShow:"A genre verdict or listener reaction from these measurements alone."}];
 if(title==="Creative identity and A&R positioning")return [{title:"Lane constellation",kind:"constellation",inferred:true,rows:[{label:"Primary lane",value:a.aAndRPositioning.primaryLane},...a.aAndRPositioning.adjacentLanes.slice(0,4).map(v=>({label:"Adjacent lane",value:v}))],shows:"The stated primary and adjacent lane hypotheses.",cantShow:"Measured genre distance, verified market size or audience overlap."}];
 if(title==="Evidence-derived scorecard")return [{title:"Evidence scorecard",kind:"radar",rows:[{label:"Tempo / lane fit",value:a.scorecard.tempoLaneFit.score},{label:"Rhythmic consistency",value:a.scorecard.rhythmicConsistency.score},{label:"Dynamic / loudness",value:a.scorecard.dynamicRangeLoudness.score},{label:"Metadata",value:a.scorecard.metadataCompleteness.score},{label:"Release readiness",value:a.scorecard.releaseReadiness.score}],shows:"Evidence-derived numeric scores for dimensions with adequate source support.",cantShow:"Artistic taste, hook quality, originality or unmeasured release outcomes."}];
 if(title==="Strengths and creative leverage")return [{title:"Strengths versus risks",kind:"tension",rows:buildStrengthRiskChartRows(a.strengths.slice(0,10),a.risks.slice(0,10)),shows:"Counts of documented strengths and risks in the assessment; counts are items, not weights.",cantShow:"Relative severity, weighting, probability of success or commercial outcomes."}];
 if(title==="Promotion plan")return [{title:"Discovery pathway",kind:"chain",rows:[{label:"Content",value:"Approved short-form excerpt"},{label:"Discovery",value:a.promotionPlan.playlistCategories[0]??"Category to investigate"},{label:"Listener action",value:"Track saves and attributable visits"}],shows:"An illustrative sequence of approved content, discovery categories and measurable next-step signals.",cantShow:"Conversion, playlist placement or audience growth."}];
 if(title==="30 / 60 / 90-day execution plan")return [{title:"Execution timeline",kind:"timeline",rows:[{label:"30 days",value:"Verify master, rights and identity"},{label:"60 days",value:"Prepare approved assets and delivery"},{label:"90 days",value:"Review evidence and decide next step"}],shows:"Concise milestones derived from the three staged execution-plan sections.",cantShow:"Calendar dates, delivery completion or guaranteed outcomes."}];
 return [];
}

function sections(i:AuditReportInput):Section[]{
 const a=i.assessment,e=i.evidence,s=i.sonicDna,hasAudio=Boolean(s&&s.provenance==="uploaded_audio_master");
 const score=(name:string,v:{score:number|null;rationale:string})=>name+" — "+(v.score===null?"NOT SCORED":v.score+"/100")+" — "+v.rationale;
 return [
 {title:"Executive assessment",accent:"blue",body:[...(e.fixture?["FIXTURE — synthetic renderer test data; not a real analysis."]:[]),a.executiveSummary,"Verdict: "+verdictLabel(a.commercialRead.marketability),"Verdict rule: "+verdictRule(a.commercialRead.marketability),"Reason: "+a.commercialRead.rationale,"Confidence: "+Math.round(a.confidence*100)+"%","Assessment basis: "+(hasAudio?"Uploaded master and supplied identity evidence.":"Metadata/provider evidence only; no uploaded master.") ]},
 {title:"Identity and source reconciliation",accent:"violet",body:["Artist: "+val(e.artist),"Track: "+val(e.title),"Album: "+val(e.album),"ISRC: "+val(e.isrc),"Release date: "+val(e.releaseDate),"Label: "+val(e.label),"Evidence sources: "+val(e.sources??e.sourceProviders)]},
 {title:"Evidence ledger and provenance",accent:"teal",body:a.evidenceLabels.map(x=>x.label+" — "+x.claim+" [Source: "+x.source+"]")},
 {title:"Sonic DNA and technical profile",accent:"blue",body:!hasAudio?(s?["Provider-supplied sonic context (not master-measured)","Provider BPM: "+val(s.bpm),"Provider key / mode: "+[text(s.key),text(s.mode)].filter(Boolean).join(" "),"Provider mood tags: "+val(s.moodTags),"Not measured: no master audio supplied."]:["Requires audio upload","Not measured: no master audio supplied."]):[e.fixture?"FIXTURE VALUES — synthetic audio-profile test data":"OBSERVED master-derived values","Tempo: "+val(s?.bpm),"Key / mode: "+[text(s?.key),text(s?.mode)].filter(Boolean).join(" "),"Loudness LUFS: "+val(s?.loudnessLufs),"Dynamic range dB: "+val(s?.dynamicRangeDb),"RMS energy: "+val(s?.rmsEnergy)]},
 {title:"Creative identity and A&R positioning",accent:"violet",body:[a.creativeIdentity,"Primary lane: "+a.aAndRPositioning.primaryLane,"Adjacent lanes: "+a.aAndRPositioning.adjacentLanes.join(", "),a.aAndRPositioning.rationale]},
 {title:"Strengths and creative leverage",accent:"teal",body:a.strengths},
 {title:"Risks and diligence",accent:"coral",body:a.risks},
 {title:"Evidence-derived scorecard",accent:"blue",body:[score("Tempo and lane fit",a.scorecard.tempoLaneFit),score("Rhythmic consistency",a.scorecard.rhythmicConsistency),score("Dynamic range and loudness readiness",a.scorecard.dynamicRangeLoudness),score("Metadata completeness",a.scorecard.metadataCompleteness),score("Release readiness",a.scorecard.releaseReadiness)]},
 {title:"Human listening checklist (unscored)",accent:"violet",body:a.humanListeningChecklist},
 {title:"Production and arrangement guidance",accent:"teal",body:[a.productionArrangementGuidance,industryPractice("General lane craft knowledge, not track-specific evidence."),industryPractice(a.industryPractice),...a.listeningChecks]},
 {title:"Comparable lanes and listening references to verify",accent:"violet",body:["INFERRED — hypotheses, not verified comparisons",a.laneHypothesis,...a.referencesToVerify,a.verificationMethod]},
 {title:"Promotion plan",accent:"coral",body:[a.promotionPlan.preRelease,a.promotionPlan.releaseWindow,a.promotionPlan.postRelease,"Content concepts: "+a.promotionPlan.contentIdeas.join(" • "),"INDUSTRY PRACTICE — pitching angles to adapt to verified track facts: "+a.promotionPlan.pitchingAngles.join(" • "),"Playlist categories to investigate only: "+a.promotionPlan.playlistCategories.join(", "),industryPractice(a.promotionPlan.industryPractice)]},
 {title:"Label and partner fit",accent:"blue",body:[a.labelPartnerFit.partnerProfile,...a.labelPartnerFit.criteriaToDemonstrate,a.labelPartnerFit.diligenceBeforeContact,industryPractice(a.labelPartnerFit.industryPractice)]},
 {title:"30 / 60 / 90-day execution plan",accent:"violet",body:["DAYS 01–30 — "+a.executionPlan.days30,"DAYS 31–60 — "+a.executionPlan.days60,"DAYS 61–90 — "+a.executionPlan.days90]},
 {title:"Commercial evidence and measurement",accent:"blue",body:[a.commercialRead.rationale,"Catalog popularity: "+val(e.catalogPopularity),"Audience telemetry: "+val(e.audienceTelemetry)]},
 {title:"Decision record and evidence gates",accent:"coral",body:[a.releaseStrategy.recommendation,...a.releaseStrategy.priorities.map((p,n)=>"Priority "+(n+1)+": "+p),"Evidence gaps: "+a.evidenceGaps.join(" "),"Limitations: "+a.limitations.join(" ")]}
 ];
}
export function chartLayoutIssuesForReport(input:AuditReportInput):string[]{
 const issues:string[]=[];for(const section of sections(input)){for(const panel of chartsForSection(input,section.title)){issues.push(...chartPanelLayoutErrors(panel.kind??"bars",panel.rows,M,TOP,chartPanelHeight(panel.kind,panel.rows)));}}return issues;
}
export function planAuditReportPages(input:AuditReportInput,tier:AuditReportTier):ReportPagePlan[]{const all=sections(input);return (tier==="sample"?all.slice(0,8):all).map(s=>({title:s.title,text:s.body}));}
export async function generateAuditReport(input:AuditReportInput,tier:AuditReportTier):Promise<Uint8Array>{
 const pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf);cover(pdf,input,fonts);
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
 if(plannedPages>18)throw new Error("Estimated report body exceeds the 20-page cap");
 let pageNo=1,page=pdf.addPage([W,H]),y=TOP,rects:ReportRect[]=[];
 header(page,"Audit findings",pageNo,fonts);
 const chromeRects=():ReportRect[]=>[{x:M,y:H-44,width:220,height:10,id:"header-brand"},{x:M,y:H-64,width:W-2*M,height:8,id:"header-title"},{x:M,y:H-68,width:W-2*M,height:0.7,id:"header-rule"},{x:M,y:43,width:W-2*M,height:0.7,id:"footer-rule"},{x:M,y:25,width:250,height:10,id:"footer-text"},{x:W-M-18,y:25,width:18,height:10,id:"footer-page-number"}];
 const validate=(densityExempt=false)=>{const layout=checkLayout([...chromeRects(),...rects]);if(!layout.ok)throw new Error(layout.errors.join("; "));const density=checkPageDensity(rects,densityExempt);if(!density.ok)console.warn("[report-layout] Page "+pageNo+" density below 65% content occupancy ("+Math.round((1-density.emptyRatio)*100)+"%); warning only.");};
 const nextPage=(title:string,accent:typeof C[keyof typeof C])=>{validate();pageNo++;page=pdf.addPage([W,H]);header(page,title,pageNo,fonts,accent);y=TOP;rects=[];};
 for(let si=0;si<selected.length;si++){
  const section=selected[si],accent=C[section.accent],titleLines=wrap(section.title,fonts.bold,19.5,W-2*M-34),titleH=titleLines.length*25+10;
  const sonicBlock=section.title==="Sonic DNA and technical profile";
  const openingHeight=section.body.slice(0,Math.min(2,section.body.length)).reduce((sum,para)=>{
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
   const para=section.body[pi],size=para===para.toUpperCase()&&para.length<100?8:9.7;
   const lines=wrap(para,fonts.regular,size,W-2*M-16),lineHeight=size*1.4;
   let offset=0,chunk=0;
   while(offset<lines.length){
    let capacity=Math.floor((y-BOTTOM-8)/lineHeight);
    if(capacity<1){nextPage(section.title,accent);capacity=Math.floor((y-BOTTOM-8)/lineHeight);}
    const count=Math.min(capacity,lines.length-offset),height=count*lineHeight+8;
    const r={x:M,y:y-height,width:W-2*M,height,id:"section-"+si+"-paragraph-"+pi+"-part-"+chunk};rects.push(r);

    for(let li=0;li<count;li++){const line=lines[offset+li];if(fonts.regular.widthOfTextAtSize(line,size)>W-2*M-16+.01)throw new Error("Text width overflow in "+r.id);page.drawText(line,{x:M+8,y:y-li*lineHeight,size,font:fonts.regular,color:size<9?accent:C.ink});}
    y-=height;offset+=count;chunk++;
    if(offset<lines.length)nextPage(section.title,accent);
   }
  }
  for(const panel of chartsForSection(input,section.title)){
   const panelHeight=chartPanelHeight(panel.kind,panel.rows);
   const layoutIssues=chartPanelLayoutErrors(panel.kind??"bars",panel.rows,M,y-8,panelHeight);if(layoutIssues.length)throw new Error(layoutIssues.join("; "));
   // Keep the chart on this page whenever its complete card clears the footer; low page fill alone is not a reason to orphan it.
   if(y-8-panelHeight<BOTTOM+45){
    nextPage(section.title,accent);
    const visualHeading=wrap(section.title,fonts.bold,14,W-2*M-20);
    visualHeading.forEach((part,index)=>page.drawText(part,{x:M+8,y:TOP-20-index*18,size:14,font:fonts.bold,color:accent}));
    page.drawText("Visual summary of the evidence and recommendations in this section.",{x:M+8,y:TOP-20-visualHeading.length*18,size:9.7,font:fonts.regular,color:C.muted});
    rects.push({x:M+8,y:TOP-20-visualHeading.length*18-5,width:W-2*M-16,height:visualHeading.length*18+30,id:"chart-context-"+si});
    y=TOP-20-visualHeading.length*18-35;
   }
   const panelTop=y-8;
   drawChartPanel(page,{...panel,y:panelTop},fonts.regular,fonts.bold);
   rects.push({x:M,y:panelTop-panelHeight,width:W-2*M,height:panelHeight,id:"chart-"+si+"-"+panel.title.replace(/\s+/g,"-")});
   y=panelTop-panelHeight-14;
  }
  y-=12;
 }
 // The final content page is intentionally exempt from density diagnostics.
 validate(true);
 const notes=pdf.addPage([W,H]);pageNo++;header(notes,"A&R notes",pageNo,fonts,C.violet);notes.drawText("A&R NOTES",{x:M,y:TOP,size:20,font:fonts.bold,color:C.navy});notes.drawText("Private working notes — editable field",{x:M,y:TOP-27,size:9,font:fonts.regular,color:C.muted});
 const form=pdf.getForm(),field=form.createTextField("ar_notes");field.enableMultiline();field.addToPage(notes,{x:M,y:145,width:W-2*M,height:470,borderWidth:1,borderColor:C.violet,backgroundColor:C.white});field.setFontSize(10);field.updateAppearances(fonts.regular);
 const noteRects=[{x:M,y:TOP-4,width:220,height:24,id:"notes-title"},{x:M,y:TOP-32,width:300,height:14,id:"notes-subtitle"},{x:M,y:145,width:W-2*M,height:470,id:"A&R notes field"}];const notesCheck=checkLayout([...chromeRects(),...noteRects]);if(!notesCheck.ok)throw new Error(notesCheck.errors.join("; ")); // A&R notes pages are form pages and are exempt from content-density diagnostics.
 if(pdf.getPageCount()>20)throw new Error("Report exceeds the 20-page cap");return pdf.save();
}
