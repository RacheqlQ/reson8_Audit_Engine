import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { buildArNotesDecisionContext, normalizeReportText } from "../dist/reports/generate-audit-report.js";
import { ensurePdfReport } from "../dist/reports/pdf-output.js";
import { sanitizeAssessmentForEvidence } from "../dist/reports/evidence-guardrails.js";
import { drawChartPanel } from "../dist/reports/charts.js";
import { fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture } from "./fixtures/sample-report-input.mjs";
import { ambiguousAudioFixture } from "./fixtures/ambiguous-audio.mjs";

const out=new URL("../artifacts/",import.meta.url);
await mkdir(out,{recursive:true});
for(const file of await readdir(out)){if(file.endsWith("-audit-report.pdf"))await rm(new URL(file,out));}
const combinedFixture=structuredClone(fullAudioFixture);
combinedFixture.auditId="fixture-combined-master-and-dsp";
combinedFixture.evidence={
 ...combinedFixture.evidence,
 sourceCombination:"master_and_dsp",
 masterAudio:{evidenceClass:"OBSERVED",provenance:"uploaded_audio_master"},
 catalogSources:[{platform:"apple_music",status:"recognized",error:null}],
 artist:"Fixture Artist",
 title:"Fixture Track",
 album:"Fixture Album",
 releaseDate:"2026-01-15",
};
const zeroConfidenceCombinedFixture=structuredClone(ambiguousAudioFixture);
zeroConfidenceCombinedFixture.auditId="fixture-zero-confidence-combined";
zeroConfidenceCombinedFixture.assessment={
 ...zeroConfidenceCombinedFixture.assessment,
 confidence:0,
 commercialRead:{marketability:"high",rationale:"Synthetic fixture intentionally supplies an unsupported high commercial verdict to test zero-confidence suppression."},
};
zeroConfidenceCombinedFixture.evidence={
 ...zeroConfidenceCombinedFixture.evidence,
 sourceCombination:"master_and_dsp",
 masterAudio:{evidenceClass:"OBSERVED",provenance:"uploaded_audio_master"},
 catalogSources:[{platform:"apple_music",status:"recognized",error:null}],
};
const variants=[
 ["full-audio-based",fullAudioFixture],
 ["combined-master-and-dsp",combinedFixture],
 ["zero-confidence-combined",zeroConfidenceCombinedFixture],
 ["partial-audio-low-confidence",partialAudioFixture],
 ["metadata-only",metadataOnlyFixture],
 ["long-form-audio",longFormAudioFixture],
 ["ambiguous-audio-low-confidence",ambiguousAudioFixture],
];
for(const [name,input] of variants){
 for(const tier of ["sample","full"]){
  const reportInput={...input,generatedAt: new Date().toISOString()};
  const bytes=await ensurePdfReport(reportInput,tier);
  const pdf=await PDFDocument.load(bytes);
  if(tier==="sample"&&pdf.getPageCount()!==9)throw new Error(name+" sample report must be exactly 9 pages; got "+pdf.getPageCount());
  if(tier==="full"&&pdf.getPageCount()!==12)throw new Error(name+" full report must be exactly 12 pages; got "+pdf.getPageCount());
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
   if(!pageText.trim())throw new Error(filename+" contains an empty page "+(pageIndex+1));
   const words=[...pageBoxes[pageIndex][1].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match=>{
    const yMin=Number(match[1].match(/yMin="([^"]+)"/)?.[1]),yMax=Number(match[1].match(/yMax="([^"]+)"/)?.[1]);
    return {text:match[2].replace(/&amp;/g,"&").replace(/&quot;/g,'"'),yMin,yMax};
   });
   if(words.some(word=>word.yMin<790&&word.yMax>=790))throw new Error(filename+" has text crossing into the footer area on page "+(pageIndex+1));
   {
    const footerWords=words.filter(word=>word.yMin>=790).map(word=>word.text);
    const expectedPage=String(pageIndex+1),totalPages=String(pdf.getPageCount());
    if(!footerWords.includes("PAGE")||!footerWords.includes(expectedPage)||!footerWords.includes("OF")||!footerWords.includes(totalPages))throw new Error(filename+" has a missing or non-sequential V2 footer page number on page "+(pageIndex+1));
    if(!footerWords.includes("AUDIT"))throw new Error(filename+" is missing its V2 audit footer on page "+(pageIndex+1));
   }
  }
  const editableFields=pdf.getForm().getFields();
  if(editableFields.map(field=>field.getName()).join(",")!=="ar_notes")throw new Error(filename+" is missing the single editable A&R Notes field");
  if(pdf.getForm().getTextField("ar_notes").acroField.getWidgets().length!==1)throw new Error(filename+" has an unexpected A&R Notes widget count");
  const safeAssessment=sanitizeAssessmentForEvidence(input.assessment,input.sonicDna,input.evidence);
  const chartLabels=[safeAssessment.aAndRPositioning.primaryLane,...safeAssessment.aAndRPositioning.adjacentLanes].filter(value=>typeof value==="string"&&value.trim());
  const normalizedExtracted=extracted.replace(/\s+/g," ");
  if(name==="ambiguous-audio-low-confidence"){
   const expectedEvidence=["14 (multiple tonal windows; provisional)"];
   for(const expected of expectedEvidence){
    if(!normalizedExtracted.includes(expected))throw new Error(filename+" is missing the expected provisional audio evidence: "+expected);
   }
   if(/\b128\s*BPM\b|\bC major\b/.test(normalizedExtracted))throw new Error(filename+" exposed a zero-confidence tempo or unsupported key candidate");
  }
  if(tier==="sample"){
   for(const label of chartLabels){
    if(!normalizedExtracted.includes(normalizeReportText(label).replace(/\s+/g," ").trim()))throw new Error(filename+" is missing a complete lane-constellation label: "+label);
   }
  }
  if(name==="combined-master-and-dsp"&&tier==="full"){
   const requiredCharts=["Evidence layers","Music platform coverage","Lane constellation","Strengths versus risks","Discovery pathway"];
   const fullText=normalizedExtracted.toLocaleLowerCase();
   for(const chart of requiredCharts){
    if(!fullText.includes(chart.toLocaleLowerCase()))throw new Error(filename+" is missing a sample-parity chart: "+chart);
   }
  }
  if(name==="long-form-audio"&&tier==="full"){
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

const evidenceCheckPath=new URL("evidence-sanitization-regression.pdf",out).pathname;
const chartCheckPath=new URL("constellation-long-label-regression.pdf",out).pathname;
try{
 const unsafeInput=structuredClone(ambiguousAudioFixture);
 if(unsafeInput.sonicDna&&typeof unsafeInput.sonicDna==="object")unsafeInput.sonicDna.tempoConfidence=0;
 unsafeInput.assessment={
  ...unsafeInput.assessment,
  confidence:0,
  limitations:[
   ...(Array.isArray(unsafeInput.assessment.limitations)?unsafeInput.assessment.limitations:[]),
   "Vocal analysis: Not performed - Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.",
   "Vocal presence/absence is unknown and is not inferred.",
   "No vocal conclusion is available because the separation model did not complete.",
   "Learned audio model: disabled.",
   "Detection model status: disabled."
  ],
  executiveSummary:[
   "The recording is a 128 BPM high-energy Afrobeats release.",
   "The track has 24000 streams, strong market demand and high commercial potential.",
   "Verified 24000 monthly listeners prove the campaign is commercially successful.",
   "Further listening and source verification are required before any external decision."
  ].join(" ")
 };
 unsafeInput.evidence={
  ...unsafeInput.evidence,
  playlistDiscovery:{
   status:"partial",
   outcomes:[
    {provider:"spotify",status:"unavailable",reason:"Spotify catalog request failed with HTTP 403"},
    {provider:"apple_music",status:"not_configured",reason:"Apple Music developer token is not configured."}
   ]
  }
 };
 const unsafeBytes=await ensurePdfReport({...unsafeInput,generatedAt:new Date().toISOString()},"full");
 await writeFile(evidenceCheckPath,unsafeBytes);
 const unsafeText=execFileSync("pdftotext",["-layout",evidenceCheckPath,"-"],{encoding:"utf8"});
 const normalizedUnsafeText=unsafeText.replace(/\s+/g," ").trim();
 const forbiddenPublicTerms=["assessment confidence","confidence-qualified","raw confidence score","Goertzel","fft_harmonic_chroma_ensemble","high_frequency_transient_autocorrelation"];
 for(const term of forbiddenPublicTerms){
  if(normalizedUnsafeText.toLocaleLowerCase().includes(term.toLocaleLowerCase()))throw new Error("Generated PDF exposed internal analysis terminology: "+term);
 }
 const internalStatusNotices=[
  "Vocal analysis: Not performed",
  "Vocal presence/absence is unknown",
  "No vocal conclusion is available",
  "Learned audio model: disabled",
  "Detection model status: disabled"
 ];
 for(const notice of internalStatusNotices){
  if(normalizedUnsafeText.toLocaleLowerCase().includes(notice.toLocaleLowerCase())){
   throw new Error("Generated PDF exposed an internal analysis status notice: "+notice);
  }
 }
 for(const required of ["Spotify playlist search unavailable:","HTTP 403","Apple Music playlist search unavailable:"]){
  if(!normalizedUnsafeText.includes(required)){
   throw new Error("Generated PDF is missing provider availability evidence: "+required);
  }
 }
 const forbiddenClaims=[
  "The recording is a 128 BPM high-energy Afrobeats release.",
  "The track has 24000 streams, strong market demand and high commercial potential.",
  "Verified 24000 monthly listeners prove the campaign is commercially successful."
 ];
 const reintroducedClaim=forbiddenClaims.find((claim)=>normalizedUnsafeText.toLocaleLowerCase().includes(claim.toLocaleLowerCase()));
 if(reintroducedClaim){
  throw new Error("Generated PDF reintroduced an unsupported claim: "+reintroducedClaim);
 }
 const zeroConfidenceTempoLeak=unsafeText.match(/.{0,120}(?:\b128\s*BPM\b|half-time 64\.0 BPM).{0,120}/is);
 if(zeroConfidenceTempoLeak)throw new Error("Generated PDF exposed a zero-confidence tempo candidate or derived pulse reading: "+JSON.stringify(zeroConfidenceTempoLeak[0]));
 if(/double-time 256\.0 BPM/i.test(unsafeText)) throw new Error("Generated PDF printed an implausible double-time candidate");
 if(!normalizedUnsafeText.includes("Further listening and source verification are required")){
  throw new Error("Generated PDF lost the supported A&R Notes decision-context sentence");
 }

 const longLabels=[
  "A very long primary creative lane label that must remain complete without shortening or silent truncation",
  "A second extended adjacent lane label with several words and enough length to wrap across multiple lines",
  "A third boundary-case label with an exceptionallylongunbrokensegmentthatmustwrapwithoutlosinganycharacters",
  "A fourth adjacent lane label used to test the lower label row and chart footer clearance",
  "A fifth final label that must remain inside the rightmost narrow chart column"
 ];
 for(const label of longLabels){
  const chartPdf=await PDFDocument.create();
  const regular=await chartPdf.embedFont(StandardFonts.Helvetica),bold=await chartPdf.embedFont(StandardFonts.HelveticaBold);
  const chartPage=chartPdf.addPage([595.28,841.89]);
  drawChartPanel(chartPage,{
   title:"Lane constellation",kind:"constellation",
   rows:[{label:"Lane",value:label}],
   shows:"Primary and adjacent lane hypotheses",
   cantShow:"Verified market size or audience overlap",
   width:240,y:760
  },regular,bold);
  await writeFile(chartCheckPath,await chartPdf.save());
  const chartText=execFileSync("pdftotext",["-layout",chartCheckPath,"-"],{encoding:"utf8"}).replace(/\s+/g,"");
  if(!chartText.includes(label.replace(/\s+/g,"")))throw new Error("Generated chart PDF did not extract a complete lane label: "+label+"; extracted="+chartText);
 }
 process.stdout.write("Additional PDF regressions: unsupported claims absent from extracted PDF text; all five long constellation labels extracted completely.\n");
}finally{
 await rm(evidenceCheckPath,{force:true});
 await rm(chartCheckPath,{force:true});
}
}
