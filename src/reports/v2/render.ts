import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { generateAuditReport, planAuditReportPages, buildArNotesDecisionContext, type AuditReportInput, type AuditReportTier } from "../generate-audit-report.js";
import { loadReportFonts } from "../fonts.js";
import { adaptReportV2, type ReportV2Data } from "./adapters.js";

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
const str=(v:unknown,fallback="Not supplied")=>typeof v==="string"&&v.trim()?v.trim():typeof v==="number"&&Number.isFinite(v)?String(v):fallback;
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const dateText=(v:unknown)=>{const s=str(v,"");return s?s.slice(0,10):"Date not supplied";};
function wrap(value:string,font:PDFFont,size:number,width:number):string[]{
 const words=value.replace(/\s+/g," ").split(" ").filter(Boolean),out:string[]=[];let line="";
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
function metricBlock(data:ReportV2Data):Block[]{
 const prov=(v:unknown)=>str(v,"Uploaded-master evidence");
 return [
  {label:"TEMPO",value:data.tempo.value===null?"N/D":data.tempo.value+" BPM",confidence:data.tempo.confidence??"Low",provenance:prov(data.tempo.evidence)},
  {label:"KEY",value:data.key.value===null?"N/D":String(data.key.value),confidence:data.key.confidence??"Low",provenance:prov(data.key.evidence)},
  {label:"ENERGY / LOUDNESS",value:data.energy.value===null?"N/D":String(data.energy.value),confidence:data.energy.confidence??"Low",provenance:prov(data.energy.evidence)}
 ];
}
function scoreChip(page:PDFPage,x:number,y:number,label:string,value:string,color:typeof C.teal,fonts:Fonts){
 page.drawRectangle({x,y,width:158,height:48,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawCircle({x:x+13,y:y+31,size:3.5,color});
 page.drawText(label.toUpperCase(),{x:x+24,y:y+28,size:6.5,font:fonts.bold,color:C.muted});
 drawWrapped(page,value,x+12,y+15,134,fonts.bold,9,color,11);
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
function identityLines(e:Record<string,unknown>):string[]{
 const reconciliation=rec(e.reconciliation),conflicts=arr(reconciliation.conflicts).map(v=>rec(v));
 const fields=["artist","title","album","releaseDate","isrc","upc","label","genre"];
 return fields.map(field=>{
  const value=str(e[field],"Unavailable");
  const conflict=conflicts.find(c=>c.field===field);
  const state=conflict?"CONFLICT":value==="Unavailable"?"UNAVAILABLE":arr(rec(reconciliation).reconciledFields).includes(field)?"CROSS-CHECKED":"SOURCE-RETURNED";
  const conflictValues=conflict?arr(conflict.values).map(v=>str(v)).join(" vs "):"";
  return field.toUpperCase()+": "+(conflict?conflictValues:value)+" ["+state+"]";
 });
}
function buildPages(input:AuditReportInput,data:ReportV2Data):PageSpec[]{
 const e=rec(input.evidence),a=rec(input.assessment),sonic=rec(input.sonicDna);
 const pages:PageSpec[]=[
  {title:"Cover and verdict",kind:"cover",blocks:metricBlock(data),lines:[
   "Artist: "+str(e.artist)+"   Track: "+str(e.title),
   "Audit date: "+dateText(input.generatedAt)+"   Release date: "+dateText(e.releaseDate),
   "Executive summary: "+str(a.executiveSummary,"No executive summary supplied."),
   "Recommended next step: "+str(rec(a.releaseStrategy).recommendation,"Complete identity, rights and master verification.")
  ]},
  {title:"Identity and source reconciliation",blocks:[],lines:[...identityLines(e),"Sources checked: "+arr(e.metadataSourcesChecked).map(v=>str(v)).join(", ")||"Sources checked: Not supplied","Platform coverage: "+str(e.platformCoverage,"Not supplied")]},
  {title:"Track snapshot",kind:"snapshot",blocks:metricBlock(data),lines:[
   ...(data.structure?["STRUCTURE — "+data.structure.map(s=>s.index+". "+s.label+" ("+s.startSeconds+"–"+s.endSeconds+"s)").join(" | ")]:[]),
   ...(data.energySeries?["ENERGY SERIES — "+data.energySeries.length+" timestamped points; peak/dip derived from supplied series."]:[])
  ]},
  ...(data.sonicAxes?[{title:"Sonic DNA",kind:"axes",blocks:Object.entries(data.sonicAxes).map(([label,v])=>({label,value:v.value+"/100",provenance:v.note??"No axis note supplied.",confidence:"Measured"}))} as PageSpec]:[]),
  ...(data.comparables?[{title:"Market placement",kind:"comparables",blocks:data.comparables.map(c=>({label:c.title,value:c.year+" · "+c.lane+" · "+c.similarity+"% similarity",provenance:c.basis+" · Source: "+c.source,confidence:"Source-attributed"}))} as PageSpec]:[]),
  ...(data.moments?[{title:"Flagged moments",kind:"moments",blocks:data.moments.map(m=>({label:m.timestampSeconds.toFixed(2)+"s · "+m.tag,value:m.title,provenance:m.note,confidence:"Timestamp supplied"}))} as PageSpec]:[]),
  {title:"Evidence ledger and scorecard",blocks:[],lines:[
   "Measured: "+(sonic?Object.keys(sonic).length:"0")+" · Source matches: "+arr(e.sources).length+" · Cross-checked: "+arr(rec(e.reconciliation).reconciledFields).length+" · Hypotheses: "+arr(a.laneHypotheses).length,
   "Headline score: "+(data.headlineScore===null?"N/D — no scored headline value supplied":data.headlineScore+"/100"),
   ...(data.scoreDrivers??[]).map(d=>d.label+": "+d.score+"/100"+(d.weight===null?"":" · weight "+d.weight)+" · "+(d.evidence||"Evidence note not supplied")),
   "Market evidence: "+(data.hasVerifiedCommercialEvidence?"Source-attributed commercial data supplied":"Insufficient — no verified commercial source data supplied.")
  ]},
  {title:"A&R positioning",blocks:[],lines:["Lane hypotheses (not facts): "+arr(a.laneHypotheses).map(v=>str(v)).join("; ")||"No lane hypotheses supplied.","Adjacent lanes: "+arr(a.adjacentLanes).map(v=>str(v)+" — unverified").join("; ")||"No adjacent lanes supplied."]},
  {title:"Strengths, risks and actions",blocks:[],lines:[
   "Strengths: "+arr(a.strengths).map(v=>str(v)).join("; ")||"No measured strengths supplied.",
   "Risks: "+arr(a.risks).map(v=>str(v)).join("; ")||"No evidenced risks supplied.",
   "Priorities: "+arr(rec(a.releaseStrategy).priorities).map(v=>str(v)).join("; ")||"No priorities supplied.",
   "Readiness: "+str(a.releaseReadiness,"Pending — no supplied readiness evidence.")
  ]},
  {title:"Release and promotion plan",blocks:[],lines:[
   Date.parse(String(e.releaseDate??""))<Date.now()?"Post-release framing: release date is in the past.":"Release framing: date does not establish a past release.",
   "General guidance: "+str(a.industryPractice,"No industry guidance supplied."),
   "Content concepts: "+arr(rec(a.promotionPlan).contentIdeas).map(v=>str(v)).join("; "),
   "Playlist categories to investigate: "+arr(rec(a.promotionPlan).playlistCategories).map(v=>str(v)).join("; "),
   ...(e.label||e.partner?["Supplied label / partner: "+str(e.label??e.partner)]:[])
  ]},
  {title:"Human listening checklist and A&R notes",blocks:[],lines:arr(a.humanListeningChecklist).map(v=>"[ ] "+str(v)).concat(["Editable notes field: use the PDF form field named ar_notes."])},
  {title:"Evidence, methodology and limitations",blocks:[],lines:[
   ...data.notYetMeasured.map(v=>"Not yet measured: "+v),
   "Tempo method: "+str(data.tempo.method,"Not supplied")+" · "+data.tempo.evidence,
   "Key method: "+str(data.key.method,"Not supplied")+" · "+data.key.evidence,
   "Energy method: "+str(data.energy.method,"Not supplied")+" · "+data.energy.evidence,
   "Worked example: when evidence is insufficient, display a dash and mark any estimate provisional; do not convert absence into a score.",
   "Limitations: "+arr(a.limitations).map(v=>str(v)).join("; "),
   "AI-assisted analysis, not a forecast."
  ]}
 ];
 return pages;
}

function drawMetricCard(page:PDFPage,x:number,top:number,width:number,block:Block,fonts:Fonts){
 const y=top-94;page.drawRectangle({x,y,width,height:94,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawText(block.label,{x:x+12,y:top-17,size:7,font:fonts.bold,color:C.muted});
 drawWrapped(page,block.value,x+12,top-43,width-24,fonts.bold,15,C.ink,18);
 const tag=block.confidence??"Low",tagColor=tag==="High"?C.teal:tag==="Medium"?C.amber:C.coral;
 page.drawRectangle({x:x+12,y:top-65,width:tag.length*5+34,height:14,color:C.paper});
 page.drawText(tag+" confidence",{x:x+17,y:top-61,size:6.5,font:fonts.bold,color:tagColor});
 drawWrapped(page,block.provenance??"Provenance not supplied",x+12,top-78,width-24,fonts.regular,6.5,C.muted,8);
}
function drawSnapshot(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const blocks=metricBlock(data),gap=10,width=(W-2*M-gap*2)/3,top=H-92;
 blocks.forEach((b,i)=>drawMetricCard(page,M+i*(width+gap),top,width,b,fonts));
 let y=top-112;
 if(data.structure){
  const height=116;card(page,M,y,W-2*M,"Structure",[],fonts,{height,accent:C.gold});
  const left=M+14,barY=y-43,barW=W-2*M-28,total=Math.max(...data.structure.map(s=>s.endSeconds));
  let x=left;const palette=[C.teal,C.gold,C.amber,C.coral];
  data.structure.forEach((s,i)=>{const w=barW*(s.endSeconds-s.startSeconds)/total;page.drawRectangle({x,y:barY,width:w,height:18,color:palette[i%palette.length]});page.drawText(String(s.index),{x:x+w/2-2,y:barY-12,size:6,font:fonts.bold,color:C.ink});x+=w;});
  let lineY=barY-28;data.structure.forEach((s,i)=>{const label=s.index+" "+s.label+"  "+s.startSeconds.toFixed(0)+"–"+s.endSeconds.toFixed(0)+"s";const col=i%2;drawWrapped(page,label,M+14+col*250,lineY-Math.floor(i/2)*12,238,fonts.regular,6.7,C.muted,8);});
  y-=height+14;
 }
 if(data.energySeries){
  const h=178,topY=y;page.drawRectangle({x:M,y:topY-h,width:W-2*M,height:h,color:C.white,borderColor:C.line,borderWidth:.7});
  page.drawText("ENERGY OVER TIME",{x:M+12,y:topY-16,size:7,font:fonts.bold,color:C.gold});
  const left=M+28,right=W-M-16,plotTop=topY-34,plotBottom=topY-h+24;
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
 }
}
function drawSonicAxes(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const axes=data.sonicAxes!;const names=Object.keys(axes) as Array<keyof typeof axes>,cx=170,cy=555,r=118;
 for(let ring=1;ring<=4;ring++){const rr=r*ring/4;for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5,b=-Math.PI/2+(i+1)*2*Math.PI/5;page.drawLine({start:{x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr},end:{x:cx+Math.cos(b)*rr,y:cy+Math.sin(b)*rr},color:C.line,thickness:.6});}}
 const pts=names.map((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5,v=axes[name].value/100;return {x:cx+Math.cos(a)*r*v,y:cy+Math.sin(a)*r*v};});
 pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];page.drawLine({start:p,end:q,color:C.teal,thickness:2.2});page.drawCircle({x:p.x,y:p.y,size:4,color:C.teal});});
 names.forEach((name,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;const x=cx+Math.cos(a)*(r+22),y=cy+Math.sin(a)*(r+22);page.drawText(name+" "+axes[name].value,{x:x-28,y,size:7,font:fonts.bold,color:C.ink});});
 const note="Five-axis Sonic DNA scores are supplied evidence. No reference-average overlay is shown because no reference set was supplied.";
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
  card(page,M,y,W-2*M,"Market position",[score+" / 100 · "+str(position.label,"Position label not supplied"),"Confidence: "+str(position.confidence,"Not supplied"),"Basis: "+str(position.basis,"Source-attributed comparables")],fonts,{accent:C.gold});
  const barX=M+14,barY=y-52,barW=W-2*M-28;page.drawRectangle({x:barX,y:barY,width:barW,height:12,color:C.line});page.drawRectangle({x:barX,y:barY,width:barW*score/100,height:12,color:C.teal});page.drawCircle({x:barX+barW*score/100,y:barY+6,size:7,color:C.white,borderColor:C.ink,borderWidth:1});y-=105;
 }
 card(page,M,y,W-2*M,"Closest comparables",[],fonts,{height:28+data.comparables!.length*43,accent:C.gold});
 const top=y-32;data.comparables!.forEach((c,i)=>{const yy=top-i*43;page.drawText(c.title,{x:M+14,y:yy,size:8,font:fonts.bold,color:C.ink});page.drawText(String(c.year)+" · "+c.lane,{x:M+170,y:yy,size:7,font:fonts.regular,color:C.muted});page.drawText(c.similarity+"%",{x:W-M-45,y:yy,size:8,font:fonts.bold,color:C.teal});drawWrapped(page,c.basis+" · "+c.source,M+14,yy-12,W-2*M-28,fonts.regular,6.5,C.muted,8);page.drawLine({start:{x:M+12,y:yy-20},end:{x:W-M-12,y:yy-20},color:C.line,thickness:.5});});
}
function drawMoments(page:PDFPage,data:ReportV2Data,fonts:Fonts){
 const moments=data.moments!,top=H-104,left=M+22,right=W-M-22,mid=top-45;
 page.drawRectangle({x:M,y:mid-30,width:W-2*M,height:90,color:C.white,borderColor:C.line,borderWidth:.7});
 page.drawLine({start:{x:left,y:mid},end:{x:right,y:mid},color:C.gold,thickness:1.4});
 const max=Math.max(...moments.map(m=>m.timestampSeconds),1);
 moments.forEach((m,i)=>{const x=left+(m.timestampSeconds/max)*(right-left);const color=m.tag==="Risk"?C.coral:m.tag==="Check"?C.amber:C.teal;page.drawLine({start:{x,y:mid-23},end:{x,y:mid+24},color,thickness:1.6});page.drawCircle({x,y:mid+26,size:8,color});page.drawText(String(i+1),{x:x-2.5,y:mid+23,size:6,font:fonts.bold,color:C.white});page.drawText(m.timestampSeconds.toFixed(1)+"s",{x:x-14,y:mid-34,size:6,font:fonts.bold,color:C.ink});});
 if(!data.energySeries)page.drawText("Moment timeline only — waveform samples were not supplied.",{x:M+14,y:mid-12,size:7,font:fonts.italic,color:C.muted});
 let y=mid-48;
 moments.forEach((m,i)=>{const h=card(page,M,y,W-2*M,m.timestampSeconds.toFixed(2)+"s · "+m.title,[m.note],fonts,{accent:m.tag==="Risk"?C.coral:m.tag==="Check"?C.amber:C.teal});y-=h+8;});
 card(page,M,y,W-2*M,"How moments are chosen",["Moments are rendered from supplied timestamped detector output or device flags. This report does not create or infer additional flags."],fonts,{accent:C.gold});
}

type FullFlowUnit = { kind: "heading"; title: string; accent: string } | { kind: "paragraph"; lines: string[]; accent: string };

async function renderFullReportV2(input: AuditReportInput, data: ReportV2Data, pdf: PDFDocument, fonts: Fonts): Promise<Uint8Array> {
 const original = await generateAuditReport(input, "full");
 const targetPageCount = (await PDFDocument.load(original)).getPageCount();
 if (targetPageCount < 3) throw new Error("The existing full report page count is too small for the v2 full-report layout.");
 const sectionPlans = planAuditReportPages(input, "full");
 const units: FullFlowUnit[] = [];
 for (const section of sectionPlans) {
  units.push({ kind: "heading", title: section.title, accent: "gold" });
  for (const paragraph of section.text) {
   const lines = wrap(paragraph, fonts.regular, 8.1, W - 2 * M - 30);
   for (let offset = 0; offset < lines.length; offset += 34) {
    units.push({ kind: "paragraph", lines: lines.slice(offset, offset + 34), accent: "gold" });
   }
  }
 }
 const bodyPageCount = targetPageCount - 2;
 const buckets: FullFlowUnit[][] = Array.from({ length: bodyPageCount }, () => []);
 const weights = units.map(unit => unit.kind === "heading" ? 28 : unit.lines.length * 10 + 18);
 const totalWeight = weights.reduce((sum, value) => sum + value, 0);
 let pageIndex = 0, accumulated = 0;
 for (let index = 0; index < units.length; index++) {
  const remainingUnits = units.length - index;
  const remainingPages = bodyPageCount - pageIndex;
  const target = totalWeight / bodyPageCount;
  if (pageIndex < bodyPageCount - 1 && buckets[pageIndex].length > 0
      && accumulated >= target * (pageIndex + 1) && remainingUnits >= remainingPages) {
   pageIndex++;
  }
  buckets[pageIndex].push(units[index]);
  accumulated += weights[index];
 }
 if (buckets.some(bucket => bucket.length === 0)) throw new Error("Full report content cannot be distributed across the existing page allocation.");

 const cover = pageBase(pdf, "Full A&R report", fonts);
 const evidence = rec(input.evidence), assessment = rec(input.assessment);
 drawWrapped(cover, "FULL A&R REPORT", M, H - 112, W - 2 * M, fonts.bold, 8, C.gold, 11);
 drawWrapped(cover, str(evidence.artist, "Artist not supplied"), M, H - 155, W - 2 * M, fonts.bold, 22, C.ink, 27);
 drawWrapped(cover, str(evidence.title, "Track not supplied"), M, H - 187, W - 2 * M, fonts.regular, 14, C.muted, 18);
 drawWrapped(cover, "Audit " + input.auditId + " · Generated " + dateText(input.generatedAt) + " · Release " + dateText(evidence.releaseDate), M, H - 211, W - 2 * M, fonts.regular, 7, C.muted, 9);
 const reconciliation = rec(evidence.reconciliation);
 const identityStatus = arr(reconciliation.conflicts).length ? "Conflict" : arr(reconciliation.reconciledFields).length ? "Recognized" : "Insufficient";
 scoreChip(cover, M, H - 285, "Audio evidence", data.tempo.value !== null || data.key.value !== null ? "Partial" : "Insufficient", C.amber, fonts);
 scoreChip(cover, M + 166, H - 285, "Identity", identityStatus, identityStatus === "Recognized" ? C.teal : C.amber, fonts);
 scoreChip(cover, M + 332, H - 285, "Market evidence", data.hasVerifiedCommercialEvidence ? "Source-attributed" : "Insufficient", data.hasVerifiedCommercialEvidence ? C.teal : C.muted, fonts);
 const metricWidth = (W - 2 * M - 16) / 3;
 metricBlock(data).forEach((block, index) => drawMetricCard(cover, M + index * (metricWidth + 8), H - 325, metricWidth, block, fonts));
 const summary = str(assessment.executiveSummary, "");
 if (summary) card(cover, M, H - 450, W - 2 * M, "Executive assessment", [summary], fonts, { accent: C.gold });
 const recommendation = str(rec(assessment.releaseStrategy).recommendation, "");
 const evidenceGap = arr(assessment.evidenceGaps).map(value => str(value, "")).find(Boolean) ?? "";
 const nextAction = recommendation || evidenceGap;
 if (nextAction) card(cover, M, H - 585, W - 2 * M, "Next action", [nextAction], fonts, { accent: C.gold });
 drawFooter(cover, "Reson8 A&R Audit", input.auditId, 1, targetPageCount, fonts);

 for (let index = 0; index < buckets.length; index++) {
  const page = pageBase(pdf, "A&R findings · " + (index + 1), fonts);
  let y = H - 94;
  for (const unit of buckets[index]) {
   if (unit.kind === "heading") {
    const lines = wrap(unit.title, fonts.bold, 11, W - 2 * M - 24);
    const h = lines.length * 14 + 13;
    if (y - h < 64) throw new Error("Full report section heading exceeds its allocated v2 page: " + unit.title);
    page.drawRectangle({ x: M, y: y - h + 2, width: W - 2 * M, height: h, color: C.white, borderColor: C.line, borderWidth: .6 });
    page.drawRectangle({ x: M, y: y - 1, width: 3, height: h - 2, color: C.gold });
    lines.forEach((line, lineIndex) => page.drawText(line, { x: M + 13, y: y - 13 - lineIndex * 14, size: 11, font: fonts.bold, color: C.ink }));
    y -= h + 7;
   } else {
    const h = unit.lines.length * 10.2 + 17;
    if (y - h < 64) throw new Error("Full report content exceeds its existing page allocation.");
    page.drawRectangle({ x: M, y: y - h + 1, width: W - 2 * M, height: h, color: C.white, borderColor: C.line, borderWidth: .5 });
    unit.lines.forEach((line, lineIndex) => page.drawText(line, { x: M + 12, y: y - 12 - lineIndex * 10.2, size: 8.1, font: fonts.regular, color: C.ink }));
    y -= h + 6;
   }
  }
  drawFooter(page, "Reson8 A&R Audit", input.auditId, index + 2, targetPageCount, fonts);
 }
 const notesPage = pageBase(pdf, "A&R notes and decision context", fonts);
 const context = buildArNotesDecisionContext(input);
 let notesY = H - 105;
 const contextHeight = 52 + wrap(context.summary, fonts.regular, 8, W - 2 * M - 28).length * 10;
 card(notesPage, M, notesY, W - 2 * M, context.heading, [context.verdict, context.summary], fonts, { accent: C.gold, height: contextHeight });
 notesY -= contextHeight + 12;
 if (context.prompts.length) {
  const promptHeight = context.prompts.reduce((sum, prompt) => sum + wrap(prompt, fonts.regular, 7.4, W - 2 * M - 28).length * 9 + 4, 0) + 18;
  card(notesPage, M, notesY, W - 2 * M, "Review prompts", context.prompts, fonts, { accent: C.gold, height: promptHeight });
 }
 notesPage.drawText("PRIVATE WORKING NOTES", { x: M, y: 195, size: 7, font: fonts.bold, color: C.gold });
 const form = pdf.getForm(), notes = form.createTextField("ar_notes");
 notes.enableMultiline();
 notes.addToPage(notesPage, { x: M, y: 66, width: W - 2 * M, height: 112, borderWidth: .7, borderColor: C.gold, backgroundColor: C.white });
 notes.setFontSize(8); notes.updateAppearances(fonts.regular);
 drawFooter(notesPage, "Reson8 A&R Audit", input.auditId, targetPageCount, targetPageCount, fonts);
 if (pdf.getPageCount() !== targetPageCount) throw new Error("Full report v2 page count differs from the existing full report.");
 return pdf.save();
}

export async function generateAuditReportV2(input:AuditReportInput,tier:AuditReportTier="sample"):Promise<Uint8Array>{
 const data=adaptReportV2(input),pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf);
 if(tier==="full") return renderFullReportV2(input,data,pdf,fonts);
 const pages=buildPages(input,data),total=pages.length;
 for(let index=0;index<pages.length;index++){
  const spec=pages[index],page=pageBase(pdf,spec.title,fonts);
  if(spec.kind==="snapshot"){
   drawSnapshot(page,data,fonts);
  }else if(spec.kind==="axes"){
   drawSonicAxes(page,data,fonts);
  }else if(spec.kind==="comparables"){
   drawComparables(page,input,data,fonts);
  }else if(spec.kind==="moments"){
   drawMoments(page,data,fonts);
  }else if(spec.kind==="cover"){
   const e=rec(input.evidence),a=rec(input.assessment);
   page.drawText("TRACK AUDIT",{x:M,y:H-112,size:8,font:fonts.bold,color:C.gold});
   drawWrapped(page,str(e.artist,"Artist not supplied"),M,H-155,W-2*M,fonts.bold,22,C.ink,27);
   drawWrapped(page,str(e.title,"Track not supplied"),M,H-186,W-2*M,fonts.regular,14,C.muted,18);
   page.drawText("AUDIT "+input.auditId+"  ·  "+dateText(input.generatedAt)+"  ·  "+dateText(e.releaseDate),{x:M,y:H-210,size:7,font:fonts.regular,color:C.muted});
   const chipY=H-260;
   scoreChip(page,M,chipY,"Audio quality","N/D — no scored quality metric",C.teal,fonts);
   const reconciliation=rec(e.reconciliation);
   const identityStatus=arr(reconciliation.conflicts).length?"Conflict":arr(reconciliation.reconciledFields).length?"Cross-checked":"Unavailable";
   scoreChip(page,M+166,chipY,"Identity confidence",identityStatus,C.amber,fonts);
   scoreChip(page,M+332,chipY,"Market evidence",data.hasVerifiedCommercialEvidence?"Source-attributed":"Insufficient",C.coral,fonts);
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
   const metricTop=H-420,width=(W-2*M-16)/3;
   spec.blocks.forEach((b,i)=>drawMetricCard(page,M+i*(width+8),metricTop,width,b,fonts));
   const summary=spec.lines?.[2]??"Executive summary not supplied.";
   card(page,M,H-535,W-2*M,"Executive summary",[summary.replace(/^Executive summary:\s*/,"")],fonts,{accent:C.gold});
   const next=spec.lines?.[3]??"Recommended next step not supplied.";
   card(page,M,H-665,W-2*M,"Recommended next step",[next.replace(/^Recommended next step:\s*/,"")],fonts,{accent:C.gold});
   page.drawText("IN THIS REPORT",{x:M,y:132,size:7,font:fonts.bold,color:C.gold});
   const toc=pages.slice(1);
   toc.forEach((p,i)=>{const col=i<5?0:1,row=i<5?i:i-5,x=M+col*250,y=110-row*15;page.drawText(String(i+2).padStart(2,"0"),{x,y,size:7,font:fonts.bold,color:C.gold});drawWrapped(page,p.title,x+28,y,205,fonts.regular,7,C.ink,8);});
  }else if(spec.kind==="axes"||spec.kind==="comparables"||spec.kind==="moments"){
   let y=H-92;for(const b of spec.blocks){const h=card(page,M,y,W-2*M,b.label,[b.value],fonts,{accent:spec.kind==="moments"?(b.label.includes("Risk")?C.coral:C.teal):C.gold,provenance:b.provenance+" · "+b.confidence});y-=h+8;}
  }else{
   let y=H-92;
   if(spec.blocks.length){for(const b of spec.blocks){const h=card(page,M,y,W-2*M,b.label,[b.value],fonts,{accent:b.confidence==="Low"?C.coral:C.teal,provenance:b.provenance+" · Confidence: "+b.confidence});y-=h+8;}}
   if(spec.lines?.length){
    const body=spec.lines.filter(Boolean),h=card(page,M,y,W-2*M,spec.title,body,fonts,{accent:C.gold});
    if(h>y-95)throw new Error("Report v2 page content exceeds available A4 space: "+spec.title);
   }
  }
  drawFooter(page,"Reson8 A&R Audit",input.auditId,index+1,total,fonts);
 }
 const form=pdf.getForm(),notes=form.createTextField("ar_notes");notes.enableMultiline();
 const last=pdf.getPages()[pages.length-2]??pdf.getPages()[0];
 notes.addToPage(last,{x:M,y:78,width:W-2*M,height:38,borderWidth:.7,borderColor:C.gold,backgroundColor:C.white});
 notes.setFontSize(8);notes.updateAppearances(fonts.regular);
 return pdf.save();
}
