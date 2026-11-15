import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReport, buildArNotesDecisionContext } from "../dist/reports/generate-audit-report.js";
import { sanitizeAssessmentForEvidence } from "../dist/reports/evidence-guardrails.js";
import { fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture } from "./fixtures/sample-report-input.mjs";
import { ambiguousAudioFixture } from "./fixtures/ambiguous-audio.mjs";

const out=new URL("../artifacts/",import.meta.url);
await mkdir(out,{recursive:true});
for(const file of await readdir(out)){if(file.endsWith("-audit-report.pdf"))await rm(new URL(file,out));}
const variants=[
 ["full-audio-based",fullAudioFixture],
 ["partial-audio-low-confidence",partialAudioFixture],
 ["metadata-only",metadataOnlyFixture],
 ["long-form-audio",longFormAudioFixture],
 ["ambiguous-audio-low-confidence",ambiguousAudioFixture],
];
for(const [name,input] of variants){
 for(const tier of ["sample","full"]){
  const reportInput={...input,generatedAt: new Date().toISOString()};
  const bytes=await generateAuditReport(reportInput,tier);
  const pdf=await PDFDocument.load(bytes);
  if(pdf.getPageCount()>20)throw new Error(name+" "+tier+" exceeded 20 pages");
  const filename=name+"-"+tier+"-audit-report.pdf";
  const fileUrl=new URL(filename,out),filePath=fileUrl.pathname;
  await writeFile(fileUrl,bytes);
  const extracted=execFileSync("pdftotext",["-layout",filePath,"-"],{encoding:"utf8"});
  const extractedPages=extracted.split("\f").filter(page=>page.trim().length>0);
  if(extractedPages.length!==pdf.getPageCount())throw new Error(filename+" extracted page count does not match the PDF page count");
  const bbox=execFileSync("pdftotext",["-bbox",filePath,"-"],{encoding:"utf8"});
  const pageBoxes=[...bbox.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
  if(pageBoxes.length!==pdf.getPageCount())throw new Error(filename+" bounding-box page count does not match the PDF page count");
  for(let pageIndex=0;pageIndex<extractedPages.length;pageIndex++){
   const pageText=extractedPages[pageIndex];
   if(pageIndex===0?!/FIXTURE/i.test(pageText):!/SYNTHETIC FIXTURE/i.test(pageText))throw new Error(filename+" is missing its synthetic-fixture disclosure on page "+(pageIndex+1));
   const words=[...pageBoxes[pageIndex][1].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match=>{
    const yMin=Number(match[1].match(/yMin="([^"]+)"/)?.[1]),yMax=Number(match[1].match(/yMax="([^"]+)"/)?.[1]);
    return {text:match[2].replace(/&amp;/g,"&").replace(/&quot;/g,'"'),yMin,yMax};
   });
   if(words.some(word=>word.yMin<790&&word.yMax>=790))throw new Error(filename+" has text crossing into the footer area on page "+(pageIndex+1));
   if(pageIndex>0){
    const footerWords=words.filter(word=>word.yMin>=790).map(word=>word.text);
    const expectedPage=String(pageIndex).padStart(2,"0");
    if(!footerWords.includes(expectedPage))throw new Error(filename+" has a missing or non-sequential footer page number on page "+(pageIndex+1));
    if(!footerWords.includes("CONFIDENTIAL")||!footerWords.includes("ASSESSMENT"))throw new Error(filename+" is missing its footer disclosure on page "+(pageIndex+1));
   }
  }
  const editableFields=pdf.getForm().getFields();
  if(editableFields.map(field=>field.getName()).join(",")!=="ar_notes")throw new Error(filename+" is missing the single editable A&R Notes field");
  if(pdf.getForm().getTextField("ar_notes").acroField.getWidgets().length!==1)throw new Error(filename+" has an unexpected A&R Notes widget count");
  const safeAssessment=sanitizeAssessmentForEvidence(input.assessment,input.sonicDna,input.evidence);
  const chartLabels=[safeAssessment.aAndRPositioning.primaryLane,...safeAssessment.aAndRPositioning.adjacentLanes].filter(value=>typeof value==="string"&&value.trim());
  const normalizedExtracted=extracted.replace(/\s+/g," ");
  for(const label of chartLabels){
   if(!normalizedExtracted.includes(label.replace(/\s+/g," ").trim()))throw new Error(filename+" is missing a complete lane-constellation label: "+label);
  }
  if(name==="long-form-audio"){
   const tokens=buildArNotesDecisionContext(input).summary.split(/\s+/).map(token=>token.replace(/[^\p{L}\p{N}#'-]/gu,"")).filter(Boolean);
   let cursor=0;
   for(const token of tokens){
    const position=normalizedExtracted.toLocaleLowerCase().indexOf(token.toLocaleLowerCase(),cursor);
    if(position<0)throw new Error(filename+" has a missing or out-of-order A&R Notes summary token: "+token);
    cursor=position+token.length;
   }
  }
  const checksum=createHash("sha256").update(await readFile(fileUrl)).digest("hex");
  process.stdout.write(filename+": "+pdf.getPageCount()+" pages; A4; disclosure, text continuity, sequential numbering, footer clearance, chart labels and editable field verified; SHA256 "+checksum+"\n");
 }
}
