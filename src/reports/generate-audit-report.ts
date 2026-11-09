import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { ArAssessment } from "../providers/groq/client.js";
import { loadReportFonts } from "./fonts.js";

export type AuditReportTier = "sample" | "full";
export interface AuditReportInput {
  auditId: string;
  generatedAt: string;
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  assessment: ArAssessment;
}
export interface ReportRect { x:number; y:number; width:number; height:number; id:string }
export interface ReportPagePlan { title:string; text:string[] }
const W=595.28, H=841.89, M=48, CONTENT_TOP=735, CONTENT_BOTTOM=76;
const C={
 navy:rgb(11/255,27/255,58/255), blue:rgb(47/255,107/255,1),
 violet:rgb(124/255,77/255,1), teal:rgb(31/255,209/255,178/255),
 coral:rgb(1,107/255,94/255), paper:rgb(247/255,245/255,240/255),
 ink:rgb(22/255,29/255,43/255), muted:rgb(91/255,101/255,119/255),
 line:rgb(220/255,222/255,226/255), white:rgb(1,1,1),
};
const txt=(v:unknown):string=>{
 if(v===null||v===undefined||v==="")return "";
 if(Array.isArray(v))return v.map(txt).filter(Boolean).join(", ");
 if(typeof v==="object")return "";
 return String(v);
};
const nonempty=(v:unknown,fallback="Evidence not supplied"):string=>txt(v)||fallback;
function wrapMeasured(text:string,font:PDFFont,size:number,width:number):string[]{
 const words=text.split(/\s+/).filter(Boolean),lines:string[]=[];let line="";
 for(const word of words){
  if(font.widthOfTextAtSize(word,size)>width) {
   if(line){lines.push(line);line="";}
   let part="";
   for(const char of word){if(font.widthOfTextAtSize(part+char,size)>width&&part){lines.push(part);part=char;}else part+=char;}
   line=part;continue;
  }
  const candidate=line?line+" "+word:word;
  if(font.widthOfTextAtSize(candidate,size)>width&&line){lines.push(line);line=word;}else line=candidate;
 }
 if(line)lines.push(line);return lines;
}
export function checkLayout(rects:ReportRect[]):{ok:boolean;errors:string[]}{
 const errors:string[]=[];
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
  const a=rects[i],b=rects[j];
  if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)errors.push("Intersecting elements: "+a.id+" / "+b.id);
 }
 for(const r of rects)if(r.x<0||r.y<0||r.x+r.width>W||r.y+r.height>H)errors.push("Out-of-page element: "+r.id);
 return {ok:errors.length===0,errors};
}
function drawText(page:PDFPage,text:string,x:number,y:number,font:PDFFont,size:number,color=C.ink):number{
 const lines=wrapMeasured(text,font,size,W-2*M);
 for(const line of lines){if(font.widthOfTextAtSize(line,size)>W-2*M+0.01)throw new Error("Text overflow: "+line);page.drawText(line,{x,y,size,font,color});y-=size*1.48;}
 return y;
}
function header(page:PDFPage,title:string,pageNo:number,fonts:{regular:PDFFont;bold:PDFFont},accent= C.blue){
 page.drawRectangle({x:0,y:H-7,width:W,height:7,color:accent});
 page.drawText("RESON8  /  A&R INTELLIGENCE",{x:M,y:H-34,size:8,font:fonts.bold,color:C.navy});
 page.drawText(title.toUpperCase(),{x:M,y:H-58,size:7,font:fonts.bold,color:accent});
 page.drawLine({start:{x:M,y:H-68},end:{x:W-M,y:H-68},color:C.line,thickness:.7});
 page.drawLine({start:{x:M,y:43},end:{x:W-M,y:43},color:C.line,thickness:.7});
 page.drawText("CONFIDENTIAL  •  EVIDENCE-LED ASSESSMENT",{x:M,y:28,size:6.5,font:fonts.regular,color:C.muted});
 page.drawText(String(pageNo).padStart(2,"0"),{x:W-M-18,y:27,size:8,font:fonts.bold,color:C.navy});
}
function cover(pdf:PDFDocument,input:AuditReportInput,fonts:{regular:PDFFont;bold:PDFFont}):void{
 const page=pdf.addPage([W,H]);page.drawRectangle({x:0,y:0,width:W,height:H,color:C.paper});
 page.drawRectangle({x:0,y:H-14,width:W,height:14,color:C.navy});
 page.drawText("RESON8",{x:M,y:H-82,size:17,font:fonts.bold,color:C.navy});
 page.drawText("A&R INTELLIGENCE",{x:M,y:H-103,size:8,font:fonts.bold,color:C.blue});
 page.drawText("TRACK AUDIT",{x:M,y:H-210,size:11,font:fonts.bold,color:C.violet});
 page.drawText("Artist & release",{x:M,y:H-260,size:31,font:fonts.bold,color:C.navy});
 page.drawText("decision brief",{x:M,y:H-299,size:31,font:fonts.bold,color:C.navy});
 const artist=nonempty(input.evidence.artist,"Artist not supplied"),title=nonempty(input.evidence.title,"Track not supplied");
 page.drawText(artist.slice(0,70),{x:M,y:H-360,size:15,font:fonts.bold,color:C.ink});
 page.drawText(title.slice(0,70),{x:M,y:H-384,size:12,font:fonts.regular,color:C.muted});
 page.drawRectangle({x:M,y:250,width:W-2*M,height:104,color:C.navy});
 page.drawText("ASSESSMENT VERDICT",{x:M+18,y:326,size:7,font:fonts.bold,color:C.teal});
 const verdict=nonempty(input.assessment.commercialRead.marketability,"UNDETERMINED").toUpperCase();
 page.drawText(verdict,{x:M+18,y:292,size:19,font:fonts.bold,color:C.white});
 page.drawText("CONFIDENCE",{x:W-M-116,y:326,size:7,font:fonts.bold,color:C.teal});
 const cx=W-M-72,cy=290,r=25,conf=Math.max(0,Math.min(1,input.assessment.confidence||0));
 page.drawCircle({x:cx,y:cy,size:r,borderColor:C.muted,borderWidth:5});
 page.drawCircle({x:cx,y:cy,size:r-5,borderColor:C.teal,borderWidth:2});
 page.drawText(Math.round(conf*100)+"%",{x:cx-13,y:cy-3,size:9,font:fonts.bold,color:C.white});
 page.drawText("Generated "+input.generatedAt.slice(0,10)+"   •   Version "+nonempty(input.assessment.assessmentVersion,"1.0"),{x:M,y:210,size:8,font:fonts.regular,color:C.muted});
 page.drawText("Audit "+input.auditId,{x:M,y:190,size:7,font:fonts.regular,color:C.muted});
 page.drawText("PRIVATE & CONFIDENTIAL",{x:M,y:54,size:7,font:fonts.bold,color:C.navy});
}
interface Section{title:string;accent:keyof typeof C;body:string[];kind?:"chart"|"checklist"}
function sections(input:AuditReportInput):Section[]{
 const a=input.assessment,e=input.evidence,s=input.sonicDna;
 const audio=Boolean(s&&s.provenance==="uploaded_audio_master");
 const missingAudio=!audio;
 const score=(label:string,entry:{score:number|null;rationale:string})=>label+"  "+(entry.score===null?"NOT SCORED":entry.score+"/100")+" — "+entry.rationale;
 const lane=nonempty(a.aAndRPositioning.primaryLane,"the proposed lane");
 const industry=[
  "INDUSTRY PRACTICE — GENERAL LANE GUIDANCE, NOT A CLAIM ABOUT THIS RECORDING.",
  "In "+lane+", release teams commonly establish the central musical proposition before selecting a lead single, sequencing supporting content and preparing DSP metadata. Confirm the convention against current specialist releases rather than treating it as a rule.",
  "Arrangement review commonly considers the opening seconds, vocal or instrumental entry, section contrast, transitions, low-end translation and the clarity of the final chorus or drop. These are listening prompts, not findings about this track.",
  "Pitching angles should connect a verifiable artist story to a specific musical feature and a timely release reason. Playlist categories to investigate may include lane-specific R&B, alternative/left-field, mood-led, regional discovery and independent new-music programming; these are categories, not placements or named curators.",
  "Content concepts can include a performance excerpt, lyric or story context, a production breakdown, a visual motif and a short-form alternate edit. Select formats only after checking rights, artist capacity and platform fit.",
  "Labels and partners in this lane typically assess identity clarity, repeatable creative direction, recording quality, rights readiness, credible release execution and evidence of audience response. No label interest or market demand is implied here."
 ];
 const scoreRows=[
  score("Tempo and lane fit",a.scorecard.sonicIdentity),
  score("Rhythmic consistency",a.scorecard.metadataIntegrity),
  score("Dynamic range / loudness readiness",a.scorecard.commercialEvidence),
  score("Metadata completeness",a.scorecard.releaseReadiness),
 ];
 const human=[
  "HUMAN LISTENING CHECKLIST — UN-SCORED",
  "Does the opening establish a distinctive musical or lyrical reason to keep listening?",
  "Can a listener identify and recall the hook after one play? Which exact phrase or motif carries it?",
  "Does the vocal performance communicate a specific point of view, and does the delivery remain compelling across sections?",
  "What feels genuinely distinctive compared with verified listening references? Which similarities are intentional?",
  "Does the arrangement create meaningful development, contrast and payoff without unnecessary repetition?",
  "Does the mix translate across headphones, phone speakers, mono and a full-range system?",
  "Would a listener replay, share or save this track? What observed listening behaviour supports that view?"
 ];
 return [
  {title:"Executive assessment",accent:"blue",body:[a.executiveSummary,"Verdict: "+nonempty(a.commercialRead.marketability,"undetermined"),"Confidence: "+Math.round((a.confidence||0)*100)+"%","Audit basis: "+(missingAudio?"Metadata / provider evidence; no uploaded master.":"Uploaded master supplied.") ]},
  {title:"Identity and source reconciliation",accent:"violet",body:["Artist: "+nonempty(e.artist),"Track: "+nonempty(e.title),"ISRC: "+nonempty(e.isrc),"Album: "+nonempty(e.album),"Release date: "+nonempty(e.releaseDate),"Label: "+nonempty(e.label),"Sources: "+nonempty(e.sources??e.sourceProviders),"Confirm every release field against the distributor's authoritative delivery record before external pitching."]},
  {title:"Evidence ledger and provenance",accent:"teal",body:a.evidenceLabels.map(x=>x.label+" — "+x.claim+"  [Source: "+x.source+"]").concat(["Evidence classes: OBSERVED, RECOGNIZED, RECONCILED, INFERRED and INDUSTRY PRACTICE. INDUSTRY PRACTICE is general craft knowledge and is not track-specific evidence."])},
  {title:"Sonic DNA and technical profile",accent:"blue",body:missingAudio?["Requires audio upload","Not measured: no master audio supplied."]:["OBSERVED: values below are derived from supplied master audio.","Tempo: "+nonempty(s?.bpm,"Not measured"),"Alternate tempo: "+nonempty(s?.alternateTempo,"Not measured"),"Key / mode: "+[txt(s?.key),txt(s?.mode)].filter(Boolean).join(" ")||"Not measured","Loudness LUFS: "+nonempty(s?.loudnessLufs,"Not measured"),"Dynamic range dB: "+nonempty(s?.dynamicRangeDb,"Not measured"),"Spectral centroid Hz: "+nonempty(s?.spectralCentroidHz,"Not measured"),"Mood: "+nonempty(s?.moodTags,"Not measured")]},
  {title:"Creative identity and A&R positioning",accent:"violet",body:[a.creativeIdentity,"Primary lane: "+lane,"Adjacent lanes: "+nonempty(a.aAndRPositioning.adjacentLanes),"Positioning rationale: "+a.aAndRPositioning.rationale]},
  {title:"Strengths and creative leverage",accent:"teal",body:a.strengths},
  {title:"Risks and diligence",accent:"coral",body:a.risks},
  {title:"Evidence-derived scorecard",accent:"blue",body:scoreRows.concat(["A numeric value is retained only where the supplied evidence supports a defensible measurement. These scores do not predict streams, signing decisions or listener response."])},
  {title:"Human listening checklist",accent:"violet",body:human,kind:"checklist"},
  {title:"Production and arrangement guidance",accent:"teal",body:["Review the opening, section transitions, vocal/instrumental balance, low-end translation, dynamic contrast and ending against the final master.", "Separate measured technical properties from aesthetic judgement. A&R production notes require a complete listening pass and time-coded observations.", ...a.limitations]},
  {title:"Comparable lanes and listening references to verify",accent:"violet",body:["INFERRED — NOT VERIFIED COMPARISONS.","Start with the primary lane "+lane+" and adjacent lanes "+nonempty(a.aAndRPositioning.adjacentLanes)+". Build a reference set from recent, independently verified releases and compare arrangement, vocal treatment, tempo feel, sound palette and release context.", "No artist, track or performance comparison is asserted as verified by this report."]},
  {title:"INDUSTRY PRACTICE: release craft",accent:"teal",body:industry},
  {title:"Promotion plan",accent:"coral",body:["Pre-release: lock master, artwork, metadata, rights and a concise verified story; prepare a short performance asset and a vertical visual concept.","Release window: coordinate DSP delivery, artist-owned channels, press materials and short-form content. Test one clear creative angle at a time; do not promise playlist placements.","Post-release: review platform-native saves, completion, returning listeners and attributable traffic at consistent intervals. Adjust content based on observed response.","Budget, reach and conversion targets remain unset until a verified baseline and spend ceiling are supplied."]},
  {title:"Label and partner fit",accent:"blue",body:["Potential partner profile: independent labels, artist-development teams and distributors whose current catalogues demonstrably align with "+lane+". This is a category-level fit hypothesis, not a claim of interest.","Prepare a concise package: approved master, one-paragraph artist proposition, credits/rights status, release plan and source-backed performance evidence.","Validate each partner's current roster, submission route, rights expectations and deal terms before contact."]},
  {title:"30 / 60 / 90-day execution plan",accent:"violet",body:["DAYS 01–30 — FOUNDATION: verify master and rights; reconcile metadata; complete human listening checklist; select the release proposition and create approved assets.","DAYS 31–60 — ACTIVATION: coordinate delivery and artist-owned content; test a small number of creative angles; log source, date, reach and response for each action.","DAYS 61–90 — REVIEW: compare like-for-like platform reporting windows; assess saves, completion, returning listeners and attributable traffic where available; decide whether to sustain, revise or pause the campaign.","Dates are relative planning windows, not a confirmed release calendar."]},
  {title:"Commercial evidence, audience and measurement",accent:"blue",body:[a.commercialRead.rationale,"Catalog popularity: "+nonempty(e.catalogPopularity,"Not supplied"),"Audience telemetry: "+nonempty(e.audienceTelemetry,"Not supplied"),"No streams, playlists, curator relationships, demographics or market-size figures are invented."]},
  {title:"Decision record and next evidence gates",accent:"coral",body:["Recommendation: "+a.releaseStrategy.recommendation,...a.releaseStrategy.priorities.map((p,i)=>"Priority "+(i+1)+": "+p),"Evidence gaps: "+a.evidenceGaps.join(" "), "Limitations: "+a.limitations.join(" ")]}
 ];
}
function drawCard(page:PDFPage,title:string,body:string[],accent:typeof C[keyof typeof C],fonts:{regular:PDFFont;bold:PDFFont},y:number):number{
 const x=M,width=W-2*M;page.drawRectangle({x:x+2,y:y-3,width,height:44,color:rgb(0.90,0.91,0.93)});
 page.drawRectangle({x,y:y-44,width,height:44,color:C.white,borderColor:C.line,borderWidth:.5});
 page.drawRectangle({x,y:y-44,width:4,height:44,color:accent});
 page.drawText(title.toUpperCase().slice(0,64),{x:x+13,y:y-17,size:7,font:fonts.bold,color:accent});
 const sample=body.join(" ").slice(0,190);
 const lines=wrapMeasured(sample,fonts.regular,7.2,width-28);
 let yy=y-29;for(const l of lines.slice(0,2)){page.drawText(l,{x:x+13,y:yy,size:7.2,font:fonts.regular,color:C.ink});yy-=10;}
 return y-55;
}
export function planAuditReportPages(input:AuditReportInput,tier:AuditReportTier):ReportPagePlan[]{
 const all=sections(input),chosen=tier==="sample"?all.slice(0,5):all;
 return chosen.map(s=>({title:s.title,text:s.body}));
}
export async function generateAuditReport(input:AuditReportInput,tier:AuditReportTier):Promise<Uint8Array>{
 const pdf=await PDFDocument.create(),fonts=loadReportFonts(pdf);
 cover(pdf,input,fonts);
 const chosen=tier==="sample"?sections(input).slice(0,5):sections(input);
 let pageNo=1,page=pdf.addPage([W,H]),y=CONTENT_TOP,rects:ReportRect[]=[];
 header(page,"Audit findings",pageNo,fonts,C.blue);
 for(const section of chosen){
  const accent=C[section.accent];
  const titleLines=wrapMeasured(section.title,fonts.bold,16,W-2*M);
  const estimatedTitle=titleLines.length*22;
  if(y-estimatedTitle<CONTENT_BOTTOM+40){pageNo++;page=pdf.addPage([W,H]);header(page,"Audit findings",pageNo,fonts,accent);y=CONTENT_TOP;rects=[];}
  page.drawText(String(chosen.indexOf(section)+1).padStart(2,"0"),{x:M,y:y-2,size:8,font:fonts.bold,color:accent});
  let ty=y;for(const line of titleLines){page.drawText(line,{x:M+34,y:ty,size:16,font:fonts.bold,color:C.navy});ty-=22;}
  y=ty-10;
  for(const para of section.body){
   const size=para===para.toUpperCase()&&para.length<100?7.2:9;
   const lines=wrapMeasured(para,fonts.regular,size,W-2*M-12);
   const height=lines.length*size*1.48+8;
   if(y-height<CONTENT_BOTTOM){const layout=checkLayout(rects);if(!layout.ok)throw new Error(layout.errors.join("; "));pageNo++;page=pdf.addPage([W,H]);header(page,section.title,pageNo,fonts,accent);y=CONTENT_TOP;rects=[];}
   const box={x:M,y:y-height,width:W-2*M,height:height,id:section.title+":"+section.body.indexOf(para)};
   rects.push(box);
   page.drawRectangle({x:M-5,y:y-height+2,width:W-2*M+10,height:height,color:section.body.indexOf(para)%2===0?C.paper:C.white});
   let yy=y;for(const line of lines){page.drawText(line,{x:M+3,y:yy,size,font:fonts.regular,color:size<8?accent:C.ink});yy-=size*1.48;}
   y-=height;
  }
  y-=18;
 }
 // One editable field, isolated on its own page and outside all body-text regions.
 const notes=pdf.addPage([W,H]);pageNo++;header(notes,"A&R notes",pageNo,fonts,C.violet);
 notes.drawText("A&R NOTES",{x:M,y:CONTENT_TOP,size:20,font:fonts.bold,color:C.navy});
 notes.drawText("Private working notes — editable field",{x:M,y:CONTENT_TOP-27,size:9,font:fonts.regular,color:C.muted});
 const form=pdf.getForm(),field=form.createTextField("ar_notes");field.enableMultiline();field.addToPage(notes,{x:M,y:145,width:W-2*M,height:470,borderWidth:1,borderColor:C.violet,backgroundColor:C.white});field.setFontSize(10);field.updateAppearances(fonts.regular);
 const check=checkLayout([{x:M,y:145,width:W-2*M,height:470,id:"A&R notes"}]);
 if(!check.ok)throw new Error(check.errors.join("; "));
 if(pdf.getPageCount()>20)throw new Error("Report exceeds the 20-page cap");\n return pdf.save();
}
