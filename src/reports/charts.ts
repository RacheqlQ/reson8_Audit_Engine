import { rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export interface ChartRow {
  label: string;
  value: string | number | null | undefined;
  rationale?: string;
  proportion?: number | null;
}

export type ChartKind = "bars" | "sonic" | "spectrum" | "constellation" | "layers" | "tension" | "timeline" | "chain" | "radar";

export interface ChartPanelInput {
  title: string;
  rows: ChartRow[];
  shows: string;
  cantShow: string;
  kind?: ChartKind;
  inferred?: boolean;
  unavailable?: boolean;
  y?: number;
}

const INK = rgb(0.14, 0.16, 0.19);
const MUTED = rgb(0.39, 0.42, 0.46);
const LINE = rgb(0.78, 0.79, 0.78);
const PAPER = rgb(0.985, 0.98, 0.96);
const SAGE = rgb(0.55, 0.62, 0.55);
const CLAY = rgb(0.69, 0.48, 0.4);
const BLUE = rgb(0.43, 0.54, 0.62);

function shown(value: ChartRow["value"]): string {
  if (value === null || value === undefined || value === "") return "Not determined";
  if (typeof value === "number" && !Number.isFinite(value)) return "Not determined";
  return String(value);
}

function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.8): void {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
}

function dashed(page: PDFPage, x: number, y: number, width: number): void {
  for (let offset = 0; offset < width; offset += 8) {
    line(page, x + offset, y, Math.min(x + offset + 3, x + width), y, LINE, 1);
  }
}

function panelFrame(page: PDFPage, input: ChartPanelInput, font: PDFFont, bold: PDFFont, height: number): { x: number; top: number; bottom: number; width: number } {
  const x = 48, width = 499, top = input.y ?? 250, bottom = top - height;
  page.drawRectangle({ x, y: bottom, width, height, borderColor: LINE, borderWidth: 0.7, color: PAPER });
  page.drawText(input.title.toUpperCase(), { x: x + 11, y: top - 17, size: 8, font: bold, color: INK });
  if (input.unavailable) page.drawText("REQUIRES AUDIO", { x: x + width - 88, y: top - 17, size: 7, font: bold, color: MUTED });
  else if (input.inferred) page.drawText("INFERRED", { x: x + width - 68, y: top - 17, size: 7, font: bold, color: CLAY });
  else page.drawText("OBSERVED", { x: x + width - 68, y: top - 17, size: 7, font: bold, color: SAGE });
  line(page, x + 10, top - 25, x + width - 10, top - 25);
  return { x, top, bottom, width };
}

function captionLines(value: string, font: PDFFont, width: number): string[] {
  const lines: string[] = []; let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(next, 5.6) > width && current) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current); return lines;
}
function captions(page: PDFPage, input: ChartPanelInput, x: number, bottom: number, font: PDFFont): void {
  let y=bottom+25;
  for(const [prefix,value] of [["SHOWS: ",input.shows],["CAN'T SHOW: ",input.cantShow]] as const){
    const lines=captionLines(prefix+value,font,475);
    for(const part of lines){if(y<bottom+3)break;page.drawText(part,{x:x+10,y,size:5.6,font,color:MUTED});y-=7;}
  }
}

function drawBars(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont, maxRows = 6): void {
  let y = top;
  for (const row of rows.slice(0, maxRows)) {
    page.drawText(row.label.slice(0, 25), { x: x + 11, y, size: 7, font: bold, color: INK });
    const value = shown(row.value);
    if (value === "Not determined") {
      dashed(page, x + 174, y + 2, 105);
      page.drawText(value, { x: x + 290, y, size: 7, font, color: MUTED });
    } else {
      page.drawText(value.slice(0, 42), { x: x + 174, y, size: 7, font, color: INK });
    }
    y -= 17;
    if (row.rationale && y > top - 85) {
      page.drawText(("RATIONALE: " + row.rationale).slice(0, 105), { x: x + 22, y, size: 5.8, font, color: MUTED });
      y -= 11;
    }
  }
}

function drawSonic(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const columns = [x + 12, x + 183, x + 354];
  rows.slice(0, 6).forEach((row, index) => {
    const col = index % 3, r = Math.floor(index / 3), cx = columns[col], cy = top - r * 57;
    page.drawCircle({ x: cx + 17, y: cy - 7, size: 12, borderColor: LINE, borderWidth: 1, color: PAPER });
    page.drawCircle({ x: cx + 17, y: cy - 7, size: 3, color: shown(row.value) === "Not determined" ? LINE : BLUE });
    page.drawText(captionLines(row.label.toUpperCase(),bold,112)[0]??"", { x: cx + 36, y: cy, size: 6.2, font: bold, color: MUTED });
    const val = shown(row.value);
    const valueLines=captionLines(val,font,112);
    valueLines.slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:cx+36,y:cy-13-lineIndex*9,size:7.2,font,color:val==="Not determined"?MUTED:INK}));
    if (val === "Not determined") dashed(page, cx + 36, cy - 19, 74);
  });
}

function drawSpectrum(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  rows.slice(0, 3).forEach((row, index) => {
    const y = top - 25 - index * 31;
    page.drawText(row.label.toUpperCase(), { x: x + 12, y, size: 6.5, font: bold, color: MUTED });
    line(page, x + 155, y + 2, x + 470, y + 2, LINE, 1);
    const val = shown(row.value);
    if (val === "Not determined") {
      dashed(page, x + 155, y + 2, 315);
      page.drawText(val, { x: x + 365, y: y + 7, size: 6, font, color: MUTED });
    } else {
      captionLines(val,font,300).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:x+165,y:y+7-lineIndex*8,size:6.4,font,color:INK}));
    }
  });
}

function drawConstellation(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const cx = x + 258, cy = top - 72;
  page.drawCircle({ x: cx, y: cy, size: 25, borderColor: BLUE, borderWidth: 1, color: PAPER });
  const primary = shown(rows[0]?.value);
  captionLines(primary,bold,82).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:cx-42,y:cy-3-lineIndex*8,size:6.2,font:bold,color:INK}));
  const adjacent = rows.slice(1, 5);
  adjacent.forEach((row, i) => {
    const px = cx + (i % 2 === 0 ? -116 : 116);
    const py = cy + (i < 2 ? 30 : -30);
    line(page, cx + (px < cx ? -25 : 25), cy, px, py, LINE);
    page.drawCircle({ x: px, y: py, size: 17, borderColor: SAGE, borderWidth: 0.8, color: PAPER });
    captionLines(shown(row.value),font,90).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:px-48,y:py-3-lineIndex*8,size:5.8,font,color:INK}));
  });
  page.drawText("QUALITATIVE POSITIONING — DISTANCE IS NOT MEASURED", { x: x + 115, y: top - 115, size: 5.8, font: bold, color: MUTED });
}

function drawLayers(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const colors = [BLUE, SAGE, CLAY, rgb(0.62, 0.58, 0.68)];
  const total = rows.reduce((sum, row) => sum + (typeof row.value === "number" && Number.isFinite(row.value) ? row.value : 0), 0);
  const barX = x + 14, barY = top - 58, barWidth = 470;
  if (total > 0) {
    page.drawRectangle({ x: barX + 2, y: barY - 2, width: barWidth, height: 20, color: INK, opacity: 0.12 });
    let offset = 0;
    rows.forEach((row, index) => {
      const count = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : 0;
      const segment = barWidth * count / total;
      if (segment > 0) page.drawRectangle({ x: barX + offset, y: barY, width: segment, height: 18, color: colors[index] });
      offset += segment;
    });
    page.drawRectangle({ x: barX, y: barY + 12, width: barWidth, height: 6, color: PAPER, opacity: 0.16 });
  } else dashed(page, barX, barY + 9, barWidth);
  rows.forEach((row, index) => {
    const y = top - 88 - index * 14;
    page.drawRectangle({ x: x + 15, y: y - 1, width: 7, height: 7, color: colors[index] });
    page.drawText(row.label + ": " + shown(row.value), { x: x + 29, y, size: 7, font, color: INK });
  });
  page.drawText(total ? "CLAIMS COUNTED FROM ASSESSMENT EVIDENCE LABELS" : "NO LABELLED CLAIMS — PROPORTIONS NOT AVAILABLE", { x: x + 270, y: top - 88, size: 5.6, font: bold, color: MUTED });
}

function drawTension(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const mid=x+249, strength=rows[0], risk=rows[1], base=top-96;
  page.drawText("STRENGTHS", {x:x+20,y:top-38,size:7,font:bold,color:SAGE});
  page.drawText("RISKS", {x:mid+18,y:top-38,size:7,font:bold,color:CLAY});
  const strengthCount=typeof strength?.value==="number"?strength.value:0;
  const riskCount=typeof risk?.value==="number"?risk.value:0;
  const max=Math.max(1,strengthCount,riskCount);
  page.drawRectangle({x:x+20,y:base,width:205,height:22,color:LINE,opacity:.22});
  page.drawRectangle({x:mid+18,y:base,width:205,height:22,color:LINE,opacity:.22});
  page.drawRectangle({x:x+20,y:base,width:205*strengthCount/max,height:22,color:SAGE,opacity:.72});
  page.drawRectangle({x:mid+18,y:base,width:205*riskCount/max,height:22,color:CLAY,opacity:.72});
  page.drawText(String(strengthCount)+" documented items",{x:x+20,y:base-18,size:7,font,color:INK});
  page.drawText(String(riskCount)+" documented items",{x:mid+18,y:base-18,size:7,font,color:INK});
  page.drawText("COUNTS ONLY · NOT WEIGHTED SEVERITY",{x:x+145,y:top-145,size:5.6,font:bold,color:MUTED});
}

function drawTimeline(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const y = top - 67;
  line(page, x + 38, y, x + 478, y, LINE, 1.2);
  rows.slice(0, 3).forEach((row, index) => {
    const px = x + 48 + index * 210;
    page.drawCircle({ x: px, y, size: 7, borderColor: BLUE, borderWidth: 1, color: PAPER });
    page.drawText("SEQUENCE " + (index + 1), { x: px - 25, y: y + 17, size: 6, font: bold, color: MUTED });
    const priority = shown(row.value);
    captionLines(priority,font,112).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:px-28,y:y-22-lineIndex*8,size:5.8,font,color:INK}));
  });
  page.drawText("30 / 60 / 90-DAY DATES: NOT DETERMINED BY THE ASSESSMENT", { x: x + 105, y: top - 115, size: 5.8, font: bold, color: MUTED });
}

function drawRadar(page:PDFPage,rows:ChartRow[],x:number,top:number,font:PDFFont,bold:PDFFont):void{
 const cx=x+249,cy=top-70,radius=43,usable=rows.slice(0,5);
 for(let ring=1;ring<=4;ring++){const r=radius*ring/4;for(let i=0;i<usable.length;i++){const a1=-Math.PI/2+i*Math.PI*2/usable.length,a2=-Math.PI/2+(i+1)*Math.PI*2/usable.length;line(page,cx+Math.cos(a1)*r,cy+Math.sin(a1)*r,cx+Math.cos(a2)*r,cy+Math.sin(a2)*r,LINE,.45);}}
 const points=usable.map((row,index)=>{const angle=-Math.PI/2+index*Math.PI*2/Math.max(1,usable.length),score=typeof row.value==="number"&&Number.isFinite(row.value)?Math.max(0,Math.min(100,row.value)):null,r=score===null?0:radius*score/100;return{x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r,angle,row,score};});
 if(points.length>=3&&points.every(p=>p.score!==null)){const path=points.map((p,i)=>(i?"L ":"M ")+p.x.toFixed(2)+" "+p.y.toFixed(2)).join(" ")+" Z";page.drawSvgPath(path,{color:BLUE,opacity:.18,borderColor:BLUE,borderOpacity:.8,borderWidth:1.2});}
 points.forEach(p=>{page.drawCircle({x:p.x,y:p.y,size:3.5,color:p.score===null?LINE:BLUE});const lx=cx+Math.cos(p.angle)*(radius+13),ly=cy+Math.sin(p.angle)*(radius+13);captionLines(p.row.label,bold,74).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:lx-37,y:ly-2-lineIndex*6,size:4.8,font:bold,color:MUTED}));page.drawText(p.score===null?"N/D":String(p.score),{x:lx-8,y:ly-12,size:5.2,font,color:INK});});
 page.drawText("EVIDENCE-DERIVED DIMENSIONS ONLY · NULL = INSUFFICIENT EVIDENCE",{x:x+120,y:top-115,size:5.5,font:bold,color:MUTED});
}
function drawChain(page: PDFPage, rows: ChartRow[], x: number, top: number, font: PDFFont, bold: PDFFont): void {
  const labels = ["CONTENT", "DISCOVERY", "LISTENER ACTION"];
  const xs = [x + 93, x + 258, x + 423];
  labels.forEach((label, index) => {
    const cx = xs[index], cy = top - 67;
    page.drawCircle({ x: cx, y: cy, size: 27, borderColor: LINE, borderWidth: 1, color: PAPER });
    page.drawText(label, { x: cx - 30, y: cy - 3, size: 4.8, font: bold, color: INK });
    if (index < 2) line(page, cx + 28, cy, xs[index + 1] - 29, cy, BLUE, 1);
    const value = shown(rows[index]?.value);
    captionLines(value,font,108).slice(0,2).forEach((part,lineIndex)=>page.drawText(part,{x:cx-55,y:cy-43-lineIndex*8,size:5.4,font,color:MUTED}));
  });
}

export function chartPanelHeight(kind:ChartKind="bars"):number{
 if(kind==="sonic")return 165;if(kind==="spectrum")return 160;if(kind==="layers")return 200;
 if(kind==="constellation"||kind==="tension"||kind==="timeline"||kind==="chain"||kind==="radar")return 190;
 return 190;
}
export function drawChartPanel(page: PDFPage, input: ChartPanelInput, font: PDFFont, bold: PDFFont): void {
  const kind = input.kind ?? "bars";
  const height = chartPanelHeight(kind);
  const frame = panelFrame(page, input, font, bold, height);
  const contentTop = frame.top - 39;
  switch (kind) {
    case "sonic": drawSonic(page, input.rows, frame.x, contentTop, font, bold); break;
    case "spectrum": drawSpectrum(page, input.rows, frame.x, contentTop, font, bold); break;
    case "constellation": drawConstellation(page, input.rows, frame.x, contentTop, font, bold); break;
    case "layers": drawLayers(page, input.rows, frame.x, contentTop, font, bold); break;
    case "tension": drawTension(page, input.rows, frame.x, contentTop, font, bold); break;
    case "timeline": drawTimeline(page, input.rows, frame.x, contentTop, font, bold); break;
    case "chain": drawChain(page, input.rows, frame.x, contentTop, font, bold); break;
    case "radar": drawRadar(page, input.rows, frame.x, contentTop, font, bold); break;
    default: drawBars(page, input.rows, frame.x, contentTop, font, bold); break;
  }
  captions(page, input, frame.x, frame.bottom, font);
}

export interface EvidenceLayerCounts {
  OBSERVED: number;
  RECOGNIZED: number;
  RECONCILED: number;
  INFERRED: number;
}

export function countEvidenceLayers(labels: Array<{ label: string }>): EvidenceLayerCounts {
  const counts: EvidenceLayerCounts = { OBSERVED: 0, RECOGNIZED: 0, RECONCILED: 0, INFERRED: 0 };
  for (const item of labels) {
    if (Object.prototype.hasOwnProperty.call(counts, item.label)) counts[item.label as keyof EvidenceLayerCounts] += 1;
  }
  return counts;
}
