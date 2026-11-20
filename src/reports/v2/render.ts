import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { AuditReportInput } from "../generate-audit-report.js";
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
 const words=value.replace(/[\r\n]+/g," ").split(/\s+/).filter(Boolean),out:string[]=[];let line="";
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
 page.drawCircle({x:x+13,y:y+24,size:4,color});
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
  {title:"Track snapshot",blocks:metricBlock(input,data),lines:[
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
export async function generateAuditReportV2(input:AuditReportInput):Promise<Uint8Array>{
 const data=adaptReportV2(input),pdf=await PDFDocument.create(),fonts=await loadReportFonts(pdf);
 const pages=buildPages(input,data),total=pages.length;
 for(let index=0;index<pages.length;index++){
  const spec=pages[index],page=pageBase(pdf,spec.title,fonts);
  if(spec.kind==="cover"){
   page.drawText("TRACK AUDIT",{x:M,y:H-112,size:8,font:fonts.bold,color:C.gold});
   drawWrapped(page,str(rec(input.evidence).artist,"Artist not supplied"),M,H-155,W-2*M,fonts.bold,22,C.ink,27);
   drawWrapped(page,str(rec(input.evidence).title,"Track not supplied"),M,H-186,W-2*M,fonts.regular,14,C.muted,18);
   const chipY=H-275;
   scoreChip(page,M,chipY,"Audio quality",data.tempo.value===null?"N/D":data.tempo.confidence??"Low",C.teal,fonts);
   scoreChip(page,M+166,chipY,"Identity confidence",str(rec(input.evidence).identityConfidence,"N/D"),C.amber,fonts);
   scoreChip(page,M+332,chipY,"Market evidence",data.hasVerifiedCommercialEvidence?"Source returned":"Insufficient",C.coral,fonts);
   if(data.headlineScore!==null)card(page,M,H-300,W-2*M,"Headline score",["Score: "+data.headlineScore+"/100",...(data.scoreDrivers??[]).map(d=>d.label+": "+d.score+"/100"+(d.weight===null?"":" · weight "+d.weight))],fonts,{accent:C.gold});
   let y=H-365;
   for(const block of spec.blocks){const h=card(page,M,y,W-2*M,block.label,[block.value],fonts,{accent:block.confidence==="Low"?C.coral:C.teal,provenance:block.provenance+" · Confidence: "+block.confidence});y-=h+8;}
   card(page,M,y,W-2*M,"Executive summary",spec.lines??[],fonts,{accent:C.gold});
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
