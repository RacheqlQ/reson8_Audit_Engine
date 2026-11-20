import { rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export interface ChartRow {
  label: string;
  value: string | number | null | undefined;
  rationale?: string;
  summary?: string;
  proportion?: number | null;
  group?: "strength" | "risk";
}
export type ChartKind = "bars" | "sonic" | "spectrum" | "constellation" | "layers" | "tension" | "timeline" | "chain" | "radar";
export type ChartEvidenceClass = "measured" | "provider-recognized" | "inferred" | "assessment-derived" | "illustrative";
export interface ChartPanelInput {
  title: string; rows: ChartRow[]; shows: string; cantShow: string;
  kind?: ChartKind; evidenceClass?: ChartEvidenceClass; inferred?: boolean; unavailable?: boolean; fixture?: boolean; y?: number; width?: number;
}
export interface ChartRect { x:number; y:number; width:number; height:number; id:string; }
const C = {
 ink:rgb(.08,.12,.2), muted:rgb(.34,.4,.5), line:rgb(.78,.82,.88), paper:rgb(.97,.98,.99),
 navy:rgb(.035,.075,.16), blue:rgb(.18,.42,1), violet:rgb(.49,.3,.94), teal:rgb(.08,.72,.62),
 coral:rgb(.96,.36,.32), gold:rgb(.94,.67,.22), sky:rgb(.22,.68,.88), green:rgb(.2,.62,.42),
 white:rgb(1,1,1), pale:rgb(.9,.94,.98)
};
const PALETTE=[C.blue,C.violet,C.teal,C.coral,C.gold,C.sky,C.green];
const CARD_X=48,CARD_W=499,HEADER_H=29,CAPTION_H=43,PAD=12;
function color(index:number){return PALETTE[index%PALETTE.length];}
export function radarScoreDisplayValue(value:number|null):string{
 return value===null||!Number.isFinite(value)?"NOT SCORED":String(Math.round(value));
}

export function parseChartMetricValue(v:ChartRow["value"]):number|null{
 if(typeof v==="number")return Number.isFinite(v)?v:null;
 if(typeof v==="string"&&/^-?\d+(?:\.\d+)?$/.test(v.trim())){const parsed=Number(v);return Number.isFinite(parsed)?parsed:null;}
 return null;
}
const validNumber=parseChartMetricValue;
export function compactChartItemSummary(value:string,maxLength=58):string{
 const clean=value.replace(/\s+/g," ").trim();
 const first=clean.split(/(?<=[.!?])\s+/)[0]??clean;
 if(first.length<=maxLength)return first;
 const clipped=first.slice(0,maxLength-1);
 const boundary=clipped.lastIndexOf(" ");
 return (boundary>Math.floor(maxLength*.55)?clipped.slice(0,boundary):clipped).replace(/[,:;\s]+$/,"")+"…";
}
export function buildStrengthRiskChartRows(strengths:string[],risks:string[]):ChartRow[]{
 return [
  {label:"Strengths",value:strengths.length},
  {label:"Risks",value:risks.length},
  ...strengths.map(label=>({label,summary:compactChartItemSummary(label),value:null,group:"strength" as const})),
  ...risks.map(label=>({label,summary:compactChartItemSummary(label),value:null,group:"risk" as const})),
 ];
}
export function strengthRiskItemsForColumn(rows:ChartRow[],group:"strength"|"risk"):ChartRow[]{
 return rows.filter(row=>row.group===group);
}

function shown(v:ChartRow["value"]):string{
 if(v===null||v===undefined||v===""||(typeof v==="number"&&!Number.isFinite(v)))return "Not determined";
 if(typeof v==="number")return String(Number(v.toFixed(2)));
 return String(v).replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/\u2026/g,"...");
}
function line(p:PDFPage,x1:number,y1:number,x2:number,y2:number,c=C.line,w=.8){p.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color:c,thickness:w});}
function normalizeChartText(value:string):string{return value.normalize("NFKC").replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[\u00A0\u202F]/g," ").replace(/\u2026/g,"...").replace(/[^\x20-\x7E\u00A0-\u00FF]/g,"?");}
function wrap(s:string,font:PDFFont,size:number,width:number):string[]{
 s=normalizeChartText(s);
 const out:string[]=[];let current="";
 for(const word of s.split(/\s+/).filter(Boolean)){
  if(font.widthOfTextAtSize(word,size)>width){
   if(current){out.push(current);current="";}
   let part="";
   for(const character of word){
    if(font.widthOfTextAtSize(part+character,size)>width&&part){out.push(part);part=character;}else part+=character;
   }
   current=part;
   continue;
  }
  const next=current?current+" "+word:word;
  if(font.widthOfTextAtSize(next,size)>width&&current){out.push(current);current=word;}else current=next;
 }
 if(current)out.push(current);return out;
}
function text(p:PDFPage,s:string,x:number,y:number,font:PDFFont,size:number,c=C.ink){p.drawText(normalizeChartText(s),{x,y,font,size,color:c});}
function tracked(p:PDFPage,s:string,x:number,y:number,font:PDFFont,size:number,c=C.ink,spacing=.55){let cursor=x;for(const ch of s){text(p,ch,cursor,y,font,size,c);cursor+=font.widthOfTextAtSize(ch,size)+spacing;}}
export function constellationLabelLineCount(row:ChartRow,width:number):number{
 const label=shown(row.value),columnWidth=Math.max(42,(width-36)/2);
 return Math.max(1,Math.ceil(label.length/Math.max(8,Math.floor(columnWidth/8.5))));
}
function constellationLabelRowHeights(rows:ChartRow[],width:number):number[]{
 const heights:number[]=[];
 for(let index=0;index<Math.min(5,rows.length);index+=2){
  const lines=Math.max(constellationLabelLineCount(rows[index],width),rows[index+1]?constellationLabelLineCount(rows[index+1],width):1);
  heights.push(lines*8+8);
 }
 return heights;
}
export function chartPanelHeight(kind:ChartKind="bars",rows:ChartRow[]=[],width=CARD_W):number{
 if(kind==="constellation")return 218+constellationLabelRowHeights(rows,width).reduce((sum,height)=>sum+height,0);
 if(kind==="radar")return 345;
 if(kind==="layers")return 180;if(kind==="tension")return 205;
 if(kind==="sonic")return 340;
 if(kind==="spectrum")return 270;
 if(kind==="timeline"||kind==="chain")return 202;
 if(kind==="bars")return 205;
 return 190;
}
export function chartPanelLayoutRects(kind:ChartKind,rows:ChartRow[],x=CARD_X,top=700,height=chartPanelHeight(kind,rows),width=CARD_W):ChartRect[]{
 const bottom=top-height,captionY=bottom+8,captionH=CAPTION_H-8;
 const contentTop=top-HEADER_H-8,contentBottom=captionY+captionH+3;
 const card:ChartRect={x,y:bottom,width,height,id:"card-bounds"};
 const result:ChartRect[]=[card,
  {x:x+8,y:captionY,width:width-16,height:captionH,id:"caption-zone"},
  {x:x+8,y:contentBottom,width:width-16,height:contentTop-contentBottom,id:"chart-content-zone"},
  {x:x+width-3,y:bottom+3,width:2,height:height-6,id:"shape-card-shadow-right"},
  {x:x+3,y:bottom+2,width:width-6,height:2,id:"shape-card-shadow-bottom"},
  {x,y:bottom,width:width,height,id:"shape-card-background"},
  {x:x+1,y:bottom+1,width:width-2,height:height-2,id:"shape-card-gradient"},
  {x,y:top-HEADER_H,width:width,height:HEADER_H,id:"shape-header-band"},
  {x,y:top-HEADER_H,width:5,height:HEADER_H,id:"shape-header-accent"},
  {x:x+13,y:top-24,width:Math.max(24,width-Math.min(155,Math.max(78,width*.38))-42),height:12,id:"shape-header-title"},
  {x:x+width-13-Math.min(155,Math.max(78,width*.38)),y:top-24,width:Math.min(155,Math.max(78,width*.38)),height:10,id:"shape-header-status"},
  {x:x+9,y:captionY+captionH,width:width-18,height:1,id:"shape-caption-divider"},
  {x:x+12,y:captionY+2,width:width-24,height:29,id:"shape-caption-text"}
 ];
 if(kind==="tension"){
  const panelTop=contentTop-4,panelBottom=contentBottom+7,panelH=panelTop-panelBottom;
  const columns=[x+14,x+width/2+10],colW=220;
  columns.forEach((cx,col)=>{
   result.push({x:cx+2,y:panelBottom+2,width:colW-4,height:panelH-4,id:"shape-tension-shadow-"+col});
   result.push({x:cx,y:panelBottom,width:colW,height:panelH,id:"shape-tension-column-"+col});
   result.push({x:cx,y:panelTop-17,width:colW,height:17,id:"shape-tension-header-"+col});
   result.push({x:cx+9,y:panelTop-15,width:colW-18,height:12,id:"label-tension-title-"+col});
   result.push({x:cx+9,y:panelTop-42,width:colW-18,height:12,id:"label-tension-count-"+col});
   result.push({x:cx+9,y:panelTop-58,width:colW-13,height:15,id:"shape-tension-count-bar-and-shadow-"+col});
   result.push({x:cx+9,y:panelTop-84,width:colW-18,height:10,id:"label-tension-detail-"+col});
  });
 }else if(kind==="spectrum"){
  const trackX=x+170,trackW=240;
  rows.slice(0,3).forEach((row,index)=>{
   const labelY=contentTop-14-index*57,trackY=labelY-24;
   result.push({x:x+14,y:labelY-3,width:145,height:11,id:"label-spectrum-name-"+index});
   const tempoWithheld = /TEMPO|BPM/.test(row.label) && validNumber(row.value) === null;
   if (!tempoWithheld) {
    result.push({x:trackX,y:trackY,width:trackW,height:8,id:"shape-spectrum-gradient-track-"+index});
    result.push({x:trackX-1,y:trackY-1,width:trackW+2,height:10,id:"shape-spectrum-track-outline-"+index});
    result.push({x:trackX-4,y:trackY-4,width:trackW+8,height:16,id:"shape-spectrum-marker-range-"+index});
    result.push({x:trackX,y:trackY-16,width:trackW,height:9,id:"label-spectrum-scale-"+index});
   }
   result.push({x:trackX+trackW+7,y:trackY-2,width:70,height:11,id:"label-spectrum-value-"+index});
  });
 }else if(kind==="radar"){
  const cx=x+width/2,cy=top-178,radius=110,outer=110,n=Math.max(3,rows.slice(0,5).length);
  result.push({x:cx-radius,y:cy-radius,width:radius*2,height:radius*2,id:"shape-radar-grid-and-polygon"});
  rows.slice(0,5).forEach((row,i)=>{
   const angle=-Math.PI/2+i*2*Math.PI/n,ax=cx+Math.cos(angle)*outer,ay=cy+Math.sin(angle)*outer;
   const label=row.label.length>23?row.label.slice(0,21)+"…":row.label,w=Math.min(86,Math.max(22,label.length*3.8));
   const left=Math.cos(angle)>.35?ax+5:Math.cos(angle)<-.35?ax-w-5:ax-w/2;
   const base=ay+(Math.sin(angle)>.4?-4:Math.sin(angle)<-.4?1:-2);
   result.push({x:cx+Math.cos(angle)*radius*.72-5,y:cy+Math.sin(angle)*radius*.72-5,width:10,height:10,id:"shape-radar-value-marker-"+i});
   result.push({x:left,y:base-13,width:w,height:21,id:"label-radar-axis-"+i});
  });
 }else if(kind==="layers"){
  const stackX=x+16,stackY=contentTop-44,stackW=width-32,stackH=24;
  result.push({x:stackX+3,y:stackY-3,width:stackW+5,height:stackH+7,id:"shape-evidence-stack-and-shadow"});
  const columns=[x+16,x+264];
  rows.slice(0,4).forEach((row,i)=>{
   const lx=columns[i%2],ly=contentBottom+34-Math.floor(i/2)*25;
   result.push({x:lx,y:ly-2,width:10,height:10,id:"shape-layer-swatch-"+i});
   result.push({x:lx+17,y:ly-2,width:205,height:10,id:"label-layer-name-"+i});
   result.push({x:lx+17,y:ly-12,width:205,height:9,id:"label-layer-value-"+i});
  });
 }else if(kind==="sonic"){
  const columns=[x+18,x+184,x+350],metricTop=contentTop-22;
  rows.slice(0,15).forEach((row,i)=>{
   const cx=columns[i%3],cy=metricTop-Math.floor(i/3)*40;
   result.push({x:cx,y:cy-44,width:145,height:44,id:"shape-sonic-metric-"+i});
  });
 }else if(kind==="bars"){
  rows.slice(0,6).forEach((row,i)=>{
   const baseline=contentTop-20-i*19;
   result.push({x:x+13,y:baseline-3,width:320,height:11,id:"label-bar-row-"+i});
  });
 }else if(kind==="constellation"){
  const labelHeights=constellationLabelRowHeights(rows,width),labelTotal=labelHeights.reduce((sum,value)=>sum+value,0);
  const cx=x+width/2,graphBottom=contentBottom+labelTotal+10,cy=graphBottom+56,radiusX=Math.min(width*.2,88),radiusY=38;
  result.push({x:cx-23,y:cy-23,width:46,height:46,id:"shape-constellation-core"});
  rows.slice(0,5).forEach((row,i)=>{
   const angle=-Math.PI/2+i*2*Math.PI/5,px=cx+Math.cos(angle)*radiusX,py=cy+Math.sin(angle)*radiusY;
   result.push({x:Math.min(cx,px)-1,y:Math.min(cy,py)-1,width:Math.abs(px-cx)+2,height:Math.abs(py-cy)+2,id:"shape-constellation-link-"+i});
   result.push({x:px-15,y:py-15,width:30,height:30,id:"shape-constellation-node-"+i});
   const labelWidth=(width-36)/2,rowIndex=Math.floor(i/2),column=i%2;
   const rowTop=graphBottom-7-labelHeights.slice(0,rowIndex).reduce((sum,value)=>sum+value,0);
   result.push({x:x+12+column*(labelWidth+12),y:rowTop-labelHeights[rowIndex]+2,width:labelWidth,height:labelHeights[rowIndex]-4,id:"label-constellation-value-"+i});
  });
 }else if(kind==="timeline"){
  const lineY=contentBottom+80;
  result.push({x:x+42,y:lineY-1,width:width-84,height:2,id:"shape-timeline-line"});
  rows.slice(0,3).forEach((row,i)=>{
   const px=i===0?x+58:i===1?x+width/2:x+width-90;
   result.push({x:px-7,y:lineY-7,width:14,height:14,id:"shape-timeline-node-"+i});
   result.push({x:px-28,y:lineY+14,width:80,height:10,id:"label-timeline-stage-"+i});
   result.push({x:px-36,y:lineY-35,width:118,height:18,id:"label-timeline-description-"+i});
  });
 }else if(kind==="chain"){
  const lineY=contentBottom+78,names=["CONTENT","DISCOVERY","LISTENER ACTION"];
  names.forEach((name,i)=>{
   const px=x+82+i*166;
   if(i<2)result.push({x:px+30,y:lineY-1,width:136,height:2,id:"shape-chain-link-"+i});
   result.push({x:px-25,y:lineY-25,width:50,height:50,id:"shape-chain-node-"+i});
   result.push({x:px-31,y:lineY-8,width:62,height:12,id:"label-chain-title-"+i});
   result.push({x:px-54,y:lineY-52,width:112,height:18,id:"label-chain-value-"+i});
  });
 }
 return result;
}
export function chartShapeBoundsErrors(card:ChartRect,shapes:ChartRect[]):string[]{
 return shapes.filter(shape=>shape.id!=="card-bounds"&&(shape.x<card.x-.01||shape.y<card.y-.01||shape.x+shape.width>card.x+card.width+.01||shape.y+shape.height>card.y+card.height+.01)).map(shape=>"Chart shape outside card: "+shape.id);
}
export function chartPanelLayoutErrors(kind:ChartKind,rows:ChartRow[],x=CARD_X,top=700,height=chartPanelHeight(kind,rows),width=CARD_W):string[]{
 const rects=chartPanelLayoutRects(kind,rows,x,top,height,width),card=rects.find(r=>r.id==="card-bounds"),caption=rects.find(r=>r.id==="caption-zone");
 if(!card||!caption)return ["Missing chart card or caption bounds"];
 const shapes=rects.filter(r=>r.id.startsWith("shape-")||r.id.startsWith("label-"));
 const errors=chartShapeBoundsErrors(card,shapes);
 for(const shape of shapes){
  if(shape.id==="shape-card-background"||shape.id==="shape-card-gradient"||shape.id==="shape-caption-text"||shape.id==="shape-caption-divider")continue;
  const hit=shape.x<caption.x+caption.width&&shape.x+shape.width>caption.x&&shape.y<caption.y+caption.height&&shape.y+shape.height>caption.y;
  if(hit)errors.push("Chart/caption collision: "+shape.id);
 }
 const labels=rects.filter(r=>r.id.startsWith("label-"));
 for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
  const a=labels[i],b=labels[j];
  if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)errors.push("Chart label collision: "+a.id+" / "+b.id);
 }
 return errors;
}
export function chartCaptionCollisionErrors(kind:ChartKind,rows:ChartRow[],x=CARD_X,top=700,height=chartPanelHeight(kind,rows)):string[]{
 return chartPanelLayoutErrors(kind,rows,x,top,height);
}
export function wrapChartSummary(value:string,font:PDFFont,size:number,width:number,maxLines=2):string[]{
 const words=value.split(/\s+/).filter(Boolean),lines:string[]=[];let current="";
 for(const word of words){const next=current?current+" "+word:word;if(font.widthOfTextAtSize(next,size)>width&&current){lines.push(current);current=word;}else current=next;}
 if(current)lines.push(current);
 if(lines.length>maxLines){
  const kept=lines.slice(0,maxLines),lastWords=kept[maxLines-1].split(/\s+/);
  while(lastWords.length&&font.widthOfTextAtSize(lastWords.join(" ")+"…",size)>width)lastWords.pop();
  kept[maxLines-1]=lastWords.length?lastWords.join(" ")+"…":"…";
  return kept;
 }
 return lines;
}
export function chartPanelStatus(input: Pick<ChartPanelInput, "fixture" | "inferred" | "unavailable" | "evidenceClass">): "SYNTHETIC FIXTURE" | "REQUIRES AUDIO" | "HYPOTHESIS" | "MEASURED" | "PROVIDER-RECOGNIZED" | "ASSESSMENT-DERIVED" | "ILLUSTRATIVE" | "UNCLASSIFIED" {
 if(input.fixture)return "SYNTHETIC FIXTURE";
 if(input.unavailable)return "REQUIRES AUDIO";
 if(input.inferred||input.evidenceClass==="inferred")return "HYPOTHESIS";
 switch(input.evidenceClass){
  case "measured":return "MEASURED";
  case "provider-recognized":return "PROVIDER-RECOGNIZED";
  case "assessment-derived":return "ASSESSMENT-DERIVED";
  case "illustrative":return "ILLUSTRATIVE";
  default:return "UNCLASSIFIED";
 }
}
export function chartPanelDisplayStatus(input: Pick<ChartPanelInput, "fixture" | "inferred" | "unavailable" | "evidenceClass">): string {
 const status=chartPanelStatus(input);
 const evidence=input.evidenceClass==="provider-recognized"?"PROVIDER-RECOGNIZED"
  :input.evidenceClass==="assessment-derived"?"ASSESSMENT-DERIVED"
  :input.evidenceClass==="illustrative"?"ILLUSTRATIVE"
  :input.evidenceClass==="inferred"||input.inferred?"HYPOTHESIS"
  :input.evidenceClass==="measured"?"MEASURED":"UNCLASSIFIED";
 const labels:string[]=[];
 if(input.fixture)labels.push("SYNTHETIC FIXTURE");
 if(input.unavailable)labels.push("REQUIRES AUDIO");
 if(status!=="SYNTHETIC FIXTURE"&&status!=="REQUIRES AUDIO")labels.push(status);
 if((!input.unavailable||(evidence!=="MEASURED"))&&!labels.includes(evidence))labels.push(evidence);
 return labels.join(" · ");
}
function drawFrame(p:PDFPage,input:ChartPanelInput,font:PDFFont,bold:PDFFont,height:number){
 const x=CARD_X,w=input.width??CARD_W,top=input.y??700,bottom=top-height;
 p.drawRectangle({x,y:bottom,width:w,height,color:C.paper,borderColor:C.line,borderWidth:.6});
 // Sixteen horizontal strips provide a restrained vertical gradient.
 for(let i=0;i<16;i++){const t=i/15;p.drawRectangle({x:x+1,y:bottom+1+(height-2)*i/16,width:w-2,height:(height-2)/16+.2,color:rgb(.985-.035*t,.99-.025*t,1-.015*t)});}
 p.drawRectangle({x:x+w-3,y:bottom+3,width:2,height:height-6,color:C.navy,opacity:.10});
 p.drawRectangle({x:x+3,y:bottom+2,width:w-6,height:2,color:C.navy,opacity:.08});
 p.drawRectangle({x,y:top-HEADER_H,width:w,height:HEADER_H,color:C.navy});
 p.drawRectangle({x,y:top-HEADER_H,width:5,height:HEADER_H,color:input.inferred?C.violet:input.unavailable?C.coral:C.teal});
 tracked(p,input.title.toUpperCase(),x+13,top-19,bold,8,C.white,.65);
 const status=chartPanelDisplayStatus(input),statusWidth=Math.min(155,Math.max(78,w*.38));
 tracked(p,status,x+w-13-statusWidth,top-19,bold,5.2,input.fixture||input.inferred?C.gold:input.unavailable?C.coral:C.teal,.25);
 const captionTop=bottom+CAPTION_H;
 line(p,x+9,captionTop,x+w-9,captionTop,C.line,.65);
 let cy=bottom+CAPTION_H-12;
 for(const [label,value] of [["SHOWS: ",input.shows],["CAN'T SHOW: ",input.cantShow]] as const){
  const lines=wrap(label+value,font,5.7,w-24).slice(0,2);
  for(const part of lines){text(p,part,x+12,cy,font,5.7,C.muted);cy-=7;}
 }
 return {x,top,bottom,width:w,height,contentTop:top-HEADER_H-9,contentBottom:captionTop+5};
}
function shadowBar(p:PDFPage,x:number,y:number,w:number,h:number,c:ReturnType<typeof rgb>,index:number){
 p.drawRectangle({x:x+2,y:y-2,width:w,height:h,color:C.navy,opacity:.13});
 p.drawRectangle({x,y,width:w,height:h,color:c});
 p.drawSvgPath(`M ${x} ${y+h} L ${x+5} ${y+h+4} L ${x+w+5} ${y+h+4} L ${x+w} ${y+h} Z`,{color:C.white,opacity:.25});
 p.drawSvgPath(`M ${x+w} ${y} L ${x+w+5} ${y+4} L ${x+w+5} ${y+h+4} L ${x+w} ${y+h} Z`,{color:C.navy,opacity:.24});
}
function ring(p:PDFPage,cx:number,cy:number,r:number,value:number|null,c:ReturnType<typeof rgb>,font:PDFFont,bold:PDFFont){
 if(value===null){for(let a=0;a<360;a+=24){const a1=a*Math.PI/180,a2=(a+12)*Math.PI/180;line(p,cx+Math.cos(a1)*(r-2),cy+Math.sin(a1)*(r-2),cx+Math.cos(a2)*(r-2),cy+Math.sin(a2)*(r-2),C.muted,1.4);}text(p,"N/D",cx-7,cy-3,bold,6,C.muted);return;}
 p.drawCircle({x:cx,y:cy,size:r,borderColor:C.line,borderWidth:5});
 const clamped=Math.max(0,Math.min(100,value));
 const segments=Math.max(1,Math.round(clamped/100*48));
 for(let i=0;i<segments;i++){const a1=(-90+i*7.5)*Math.PI/180,a2=(-90+(i+1)*7.5-1)*Math.PI/180;line(p,cx+Math.cos(a1)*r,cy+Math.sin(a1)*r,cx+Math.cos(a2)*r,cy+Math.sin(a2)*r,c,4.5);}
 text(p,Math.round(clamped)+"%",cx-10,cy-3,bold,7,C.ink);
}
function drawSonic(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const cols=[g.x+18,g.x+184,g.x+350],top=g.contentTop-22;
 rows.slice(0,15).forEach((row,i)=>{
  const col=i%3,r=Math.floor(i/3),x=cols[col],y=top-r*40,c=color(i),v=validNumber(row.value);
  const label=row.label.toUpperCase();
  tracked(p,label,x,y,b,6.3,C.muted,.35);
  const display=shown(row.value);
  const isPercent=(/CONFIDENCE|SCORE|PERCENT/i.test(label)&&v!==null)||(typeof row.value==="string"&&/%$/.test(row.value));
  if(isPercent){
   const parsed=v??(typeof row.value==="string"&&/%$/.test(row.value)?Number.parseFloat(row.value):null),n=typeof parsed==="number"&&Number.isFinite(parsed)?parsed:null;
   ring(p,x+22,y-24,13,n===null?null:n,c,f,b);
   if(n===null)text(p,"Not determined",x+41,y-27,f,6.2,C.muted);
  }else if(v!==null){
   const unit=/LUFS/i.test(label)?"LUFS":/\bLRA\b/i.test(label)?"LU":/BPM/i.test(label)?"BPM":/RANGE|SPREAD/i.test(label)?"dB":/HZ|ROLLOFF|CENTROID/i.test(label)?"Hz":"";
   let metricSize=25;
   const maxMetricWidth=unit?102:138;
   while(metricSize>11&&b.widthOfTextAtSize(display,metricSize)>maxMetricWidth)metricSize-=1;
   text(p,display,x,y-28,b,metricSize,c);
   const unitX=x+b.widthOfTextAtSize(display,metricSize)+5;
   if(unit&&unitX+b.widthOfTextAtSize(unit,7)<=x+150)text(p,unit,unitX,y-26,b,7,C.muted);
  }else if(/^KEY \/ MODE$/.test(label)&&display!=="Not determined"){
   let keySize=15;while(keySize>9&&b.widthOfTextAtSize(display,keySize)>138)keySize-=1;
   text(p,display,x,y-27,b,keySize,c);
  }else if(display!=="Not determined"&&display!=="Not supplied"&&display!=="null"){
   const valueLines=wrap(display,f,7.2,145);
   const visible=valueLines.slice(0,2);
   if(valueLines.length>2&&visible.length)visible[1]=visible[1].replace(/[.…]*$/,"")+"…";
   visible.forEach((valueLine,index)=>text(p,valueLine,x,y-18-index*8.5,f,7.2,c));
  }else{
   ring(p,x+14,y-24,11,null,c,f,b);
   text(p,"Not determined",x+33,y-26,f,6.0,C.muted);
  }
 });
}
function drawLayers(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const valid=rows.map(r=>Math.max(0,validNumber(r.value)??0)),total=valid.reduce((a,v)=>a+v,0);
 const x=g.x+16,y=g.contentTop-44,w=g.width-32,h=24;
 p.drawRectangle({x:x+3,y:y-3,width:w,height:h,color:C.navy,opacity:.13});
 if(total>0){let offset=0;valid.forEach((n,i)=>{const sw=w*n/total;if(sw>0)shadowBar(p,x+offset,y,sw,h,color(i),i);offset+=sw;});}
 else{for(let k=0;k<w;k+=12)line(p,x+k,y+12,Math.min(x+k+5,x+w),y+12,C.muted,1);}
 const columns=[g.x+16,g.x+264];
 rows.slice(0,4).forEach((row,i)=>{const col=i%2,r=Math.floor(i/2),lx=columns[col],ly=g.contentBottom+34-r*25,c=color(i);
  p.drawRectangle({x:lx,y:ly-2,width:10,height:10,color:c});
  tracked(p,row.label.toUpperCase(),lx+17,ly,b,6.7,c,.35);
  text(p,shown(row.value),lx+17,ly-10,f,6.3,C.ink);
 });
}
function drawRadar(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const data=rows.slice(0,5),cx=g.x+g.width/2,cy=(g.contentTop+g.contentBottom)/2-10;
 const radius=110,n=Math.max(3,data.length),outer=110;
 // The full plot/label footprint is 60%+ of the card width.
 for(let ringIndex=1;ringIndex<=4;ringIndex++){const r=radius*ringIndex/4;const pts=data.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return{x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};});for(let i=0;i<pts.length;i++)line(p,pts[i].x,pts[i].y,pts[(i+1)%pts.length].x,pts[(i+1)%pts.length].y,C.line,.65);}
 const pts=data.map((row,i)=>{const angle=-Math.PI/2+i*2*Math.PI/n,score=validNumber(row.value),r=score===null?0:radius*Math.max(0,Math.min(100,score))/100;return{row,angle,score,x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r};});
 const scored=pts.filter(q=>q.score!==null);if(scored.length>=3){const path=scored.map((q,i)=>(i?"L ":"M ")+q.x.toFixed(2)+" "+q.y.toFixed(2)).join(" ")+" Z";p.drawSvgPath(path,{color:C.teal,opacity:.24,borderColor:C.blue,borderOpacity:1,borderWidth:1.7});}
 pts.forEach((q,i)=>{
  const ax=cx+Math.cos(q.angle)*outer,ay=cy+Math.sin(q.angle)*outer;
  line(p,cx+Math.cos(q.angle)*radius,cy+Math.sin(q.angle)*radius,ax,ay,C.muted,.6);
  if(q.score===null){p.drawCircle({x:cx+Math.cos(q.angle)*radius*.72,y:cy+Math.sin(q.angle)*radius*.72,size:4,borderColor:C.coral,borderWidth:1.2,color:C.paper});}
  else p.drawCircle({x:q.x,y:q.y,size:4,color:C.coral,borderColor:C.white,borderWidth:.7});
  const label=q.row.label.length>23?q.row.label.slice(0,21)+"…":q.row.label;
  const align=Math.cos(q.angle)>.35?"left":Math.cos(q.angle)<-.35?"right":"center";
  const width=b.widthOfTextAtSize(label,6.2),lx=align==="left"?ax+5:align==="right"?ax-width-5:ax-width/2;
  const ly=ay+(Math.sin(q.angle)>.4?-4:Math.sin(q.angle)<-.4?1:-2);
  text(p,label,lx,ly,b,6.2,C.ink);
  const scoreText=radarScoreDisplayValue(q.score);
  const scoreWidth=f.widthOfTextAtSize(scoreText,6.2);
  text(p,scoreText,align==="left"?lx:align==="right"?lx+width-scoreWidth:lx+(width-scoreWidth)/2,ly-9,b,6.2,q.score===null?C.coral:C.blue);
 });
}
function drawTension(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const mid=g.x+g.width/2,cols=[g.x+14,mid+10],colW=220;
 const maxCount=Math.max(1,validNumber(rows[0]?.value)??0,validNumber(rows[1]?.value)??0);
 const panelTop=g.contentTop-4,panelBottom=g.contentBottom+7,panelHeight=panelTop-panelBottom;
 for(let c=0;c<2;c++){
  const row=rows[c],accent=c===0?C.teal:C.coral,title=c===0?"STRENGTHS":"RISKS";
  const count=validNumber(row?.value)??0,x=cols[c];
  p.drawRectangle({x:x+2,y:panelBottom+2,width:colW-4,height:panelHeight-4,color:C.navy,opacity:.08});
  p.drawRectangle({x,y:panelBottom,width:colW,height:panelHeight,color:C.white,borderColor:accent,borderWidth:.8});
  p.drawRectangle({x,y:panelTop-17,width:colW,height:17,color:accent});
  tracked(p,title,x+9,panelTop-12,b,7,C.white,.5);
  text(p,String(count)+" documented",x+9,panelTop-37,b,9,accent);
  shadowBar(p,x+9,panelTop-56,(colW-18)*count/maxCount,5,accent,c);
  const firstItem=rows.find((item)=>item.group===(c===0?"strength":"risk"));
  const summary=firstItem?.summary??firstItem?.label??"No item recorded";
  const summaryLines=wrapChartSummary(summary,f,6.2,colW-18,1);
  text(p,summaryLines[0]??"No item recorded",x+9,panelTop-78,f,6.2,C.muted);
 }
}
export interface SpectrumScale { min:number; max:number; unit:string; }
export function spectrumScaleForValue(label:string,value:ChartRow["value"]):SpectrumScale|null {
 if(/TEMPO|BPM/.test(label)&&validNumber(value)===null)return null;
 return /TEMPO|BPM/.test(label)?{min:60,max:180,unit:"BPM"}:/RMS\s+ENERGY/.test(label)?{min:0,max:1,unit:""}:/RMS\s+ENVELOPE\s+SPREAD/.test(label)?{min:0,max:40,unit:"dB"}:{min:0,max:20,unit:"dB"};
}
function drawSpectrum(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const trackX=g.x+170,trackW=240,trackH=8;
 rows.slice(0,3).forEach((row,index)=>{
  const label=row.label.toUpperCase(),labelY=g.contentTop-14-index*57,trackY=labelY-24;
  tracked(p,label,g.x+14,labelY,b,6.5,color(index),.4);
  const raw=validNumber(row.value)??(typeof row.value==="string"?Number.parseFloat(row.value):NaN);
  const isTempo = /TEMPO|BPM/.test(label);
  const range=spectrumScaleForValue(label,row.value);
  if(range===null){
   text(p,"Tempo withheld — insufficient confidence",trackX,trackY+1,f,6.2,C.muted);
   return;
  }
  const known=Number.isFinite(raw),ratio=known?Math.max(0,Math.min(1,(raw-range.min)/(range.max-range.min))):null;
  if (isTempo && ratio === null) {
   text(p,"Tempo withheld — insufficient confidence",trackX,trackY+1,f,6.2,C.muted);
   return;
  }
  if(ratio===null){
   for(let strip=0;strip<16;strip++){const sx=trackX+strip*(trackW/16);p.drawRectangle({x:sx,y:trackY,width:trackW/32,height:trackH,color:C.muted,opacity:.42});}
   text(p,"Not determined",trackX+trackW+7,trackY+1,f,6.5,C.muted);
  }else{
   for(let strip=0;strip<16;strip++){const t=strip/15;p.drawRectangle({x:trackX+strip*(trackW/16),y:trackY,width:trackW/16+.2,height:trackH,color:rgb(.18+.04*t,.42+.32*t,.96-.48*t)});}
   const markerX=trackX+ratio*trackW;
   p.drawLine({start:{x:markerX,y:trackY-4},end:{x:markerX,y:trackY+trackH+4},color:C.coral,thickness:2});
   p.drawCircle({x:markerX,y:trackY+trackH/2,size:4,color:C.coral,borderColor:C.white,borderWidth:.8});
   text(p,String(Number(raw.toFixed(2)))+(range.unit?" "+range.unit:""),trackX+trackW+7,trackY+1,b,7,C.ink);
  }
  if (!isTempo || ratio !== null) {
   text(p,String(range.min),trackX,trackY-13,f,5.8,C.muted);
   text(p,String(range.max)+(range.unit?" "+range.unit:""),trackX+trackW-36,trackY-13,f,5.8,C.muted);
  }
 });
}
function drawBars(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 rows.slice(0,6).forEach((r,i)=>{const y=g.contentTop-20-i*19,c=color(i);text(p,r.label.slice(0,25),g.x+13,y,b,7,c);text(p,shown(r.value).slice(0,48),g.x+178,y,f,7,C.ink);});
}
function drawConstellation(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const visibleRows=rows.slice(0,5),labelHeights=constellationLabelRowHeights(visibleRows,g.width),labelTotal=labelHeights.reduce((sum,value)=>sum+value,0);
 const cx=g.x+g.width/2,graphBottom=g.contentBottom+labelTotal+10,cy=graphBottom+56,radiusX=Math.min(g.width*.2,88),radiusY=38;
 p.drawCircle({x:cx,y:cy,size:23,borderColor:C.violet,borderWidth:1.4,color:C.paper});
 text(p,"PRIMARY",cx-12,cy-2,b,4.5,C.violet);
 const adjacentRows=visibleRows.slice(1);
 if(adjacentRows.length===0){
  text(p,"No adjacent lanes established",cx-49,cy-34,f,6,C.muted);
 }
 adjacentRows.forEach((row,i)=>{
  const angle=-Math.PI/2+i*2*Math.PI/Math.max(adjacentRows.length,3),px=cx+Math.cos(angle)*radiusX,py=cy+Math.sin(angle)*radiusY;
  line(p,cx,cy,px,py,color(i+1),1);p.drawCircle({x:px,y:py,size:15,borderColor:color(i+1),borderWidth:1,color:C.white});
 });
 visibleRows.forEach((row,i)=>{
  const labelWidth=(g.width-36)/2,rowIndex=Math.floor(i/2),column=i%2;
  const rowTop=graphBottom-7-labelHeights.slice(0,rowIndex).reduce((sum,value)=>sum+value,0);
  const labelX=g.x+12+column*(labelWidth+12),labelBottom=rowTop-labelHeights[rowIndex]+2;
  p.drawCircle({x:labelX+3,y:labelBottom+labelHeights[rowIndex]/2-2,size:2.2,color:color(i)});
  const lines=wrap(shown(row.value),f,5.6,labelWidth-12);
  lines.forEach((part,lineIndex)=>text(p,part,labelX+11,rowTop-9-lineIndex*8,f,5.6,C.ink));
 });
}
function drawTimeline(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const y=g.contentBottom+80;line(p,g.x+42,y,g.x+g.width-42,y,C.line,1.4);
 const nodes=[g.x+58,g.x+g.width/2,g.x+g.width-90];
 rows.slice(0,3).forEach((r,i)=>{const x=nodes[i];p.drawCircle({x,y,size:7,color:color(i)});text(p,"STAGE "+(i+1),x-20,y+18,b,6,color(i));wrap(shown(r.value),f,6,115).slice(0,2).forEach((s,j)=>text(p,s,x-35,y-18-j*8,f,6,C.ink));});
}
function drawChain(p:PDFPage,rows:ChartRow[],f:PDFFont,b:PDFFont,g:ReturnType<typeof drawFrame>){
 const names=["CONTENT","DISCOVERY","LISTENER ACTION"];
 names.forEach((name,i)=>{const x=g.x+82+i*166,y=g.contentBottom+78;if(i<2)line(p,x+30,y,g.x+82+(i+1)*166-30,y,C.blue,1.5);p.drawCircle({x,y,size:25,borderColor:color(i),borderWidth:1.3,color:C.white});text(p,name,x-30,y-3,b,4.7,color(i));wrap(shown(rows[i]?.value),f,5.8,110).slice(0,2).forEach((s,j)=>text(p,s,x-54,y-39-j*8,f,5.8,C.ink));});
}
export function drawChartPanel(page:PDFPage,input:ChartPanelInput,font:PDFFont,bold:PDFFont):void{
 const kind=input.kind??"bars",height=chartPanelHeight(kind,input.rows,input.width??CARD_W),g=drawFrame(page,input,font,bold,height);
 switch(kind){
  case "sonic":drawSonic(page,input.rows,font,bold,g);break;
  case "layers":drawLayers(page,input.rows,font,bold,g);break;
  case "radar":drawRadar(page,input.rows,font,bold,g);break;
  case "tension":drawTension(page,input.rows,font,bold,g);break;
  case "spectrum":drawSpectrum(page,input.rows,font,bold,g);break;
  case "constellation":drawConstellation(page,input.rows,font,bold,g);break;
  case "timeline":drawTimeline(page,input.rows,font,bold,g);break;
  case "chain":drawChain(page,input.rows,font,bold,g);break;
  default:drawBars(page,input.rows,font,bold,g);
 }
}
export interface EvidenceLayerCounts{OBSERVED:number;RECOGNIZED:number;RECONCILED:number;INFERRED:number;}
export function countEvidenceLayers(labels:Array<{label:string}>):EvidenceLayerCounts{
 const counts:EvidenceLayerCounts={OBSERVED:0,RECOGNIZED:0,RECONCILED:0,INFERRED:0};
 for(const item of labels){if(Object.prototype.hasOwnProperty.call(counts,item.label))counts[item.label as keyof EvidenceLayerCounts]+=1;}
 return counts;
}
