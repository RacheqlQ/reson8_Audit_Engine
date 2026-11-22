import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReportV2 } from "../dist/reports/v2/render.js";
import { adaptReportV2 } from "../dist/reports/v2/adapters.js";
import { buildMarketPlacementPlan } from "../dist/strategy/market-placement.js";
import { ambiguousAudioFixture } from "./fixtures/ambiguous-audio.mjs";
import { fullAudioFixture, metadataOnlyFixture } from "./fixtures/sample-report-input.mjs";

const out=new URL("../artifacts/",import.meta.url);
await mkdir(out,{recursive:true});
const expectedArFields=["ar_notes","ar_owner","ar_followup_date","ar_decision_hold","ar_decision_reaudit","ar_decision_proceed"].sort();
function assertArNotes(pdf,name,notesPageText){
 const fields=pdf.getForm().getFields().map(field=>field.getName()).sort();
 if(JSON.stringify(fields)!==JSON.stringify(expectedArFields))throw new Error(name+" has unexpected A&R Notes AcroForm fields: "+fields.join(", "));
 const notesWidget=pdf.getForm().getTextField("ar_notes").acroField.getWidgets()[0];
 if(notesWidget.getRectangle().height<295)throw new Error(name+" A&R working-notes field is below 35 percent of A4 page height");
 const page=pdf.getPages().at(-1);
 if(Math.abs(page.getWidth()-595.28)>1||Math.abs(page.getHeight()-841.89)>1)throw new Error(name+" A&R Notes page is not A4");
 if(notesPageText.includes("...")||notesPageText.includes("…"))throw new Error(name+" A&R Notes page contains ellipsis truncation");
 if(notesPageText.includes("[ ]"))throw new Error(name+" A&R Notes page must use vector checkboxes, not bracket text");
 const normalizedText=notesPageText.replace(/\s+/g," ");
 const upper=normalizedText.toUpperCase();
 for(const label of ["AUDIO","IDENTITY","MARKET","RELEASE READINESS","HUMAN LISTENING REVIEW","A&R DECISION CONTEXT","DECISION BASIS","OPEN DILIGENCE","NEXT ACTION","WORKING NOTES"]){
  if(!upper.includes(label))throw new Error(name+" A&R Notes page is missing "+label);
 }
 for(const prompt of [
  "What evidence would change the current decision?",
  "Which identity, rights or source gaps remain unresolved?",
  "What should be verified before any external pitch?"
 ])if(!normalizedText.includes(prompt))throw new Error(name+" A&R Notes page is missing review prompt: "+prompt);
}
const phillo=structuredClone(ambiguousAudioFixture);
phillo.auditId="fixture-phillo-stunixx-low-confidence";
phillo.evidence={...phillo.evidence,artist:"Stunixx",title:"Phillo",album:null,isrc:null,upc:null,label:null,genre:null,releaseDate:"2025-08-24",fieldProvenance:{...phillo.evidence.fieldProvenance,releaseDate:"apple_music"},reconciliation:{conflicts:[{field:"album",values:["Hole-Hearted - EP","Hole-Hearted"]}]}};
phillo.assessment={...phillo.assessment,executiveSummary:"Synthetic reference fixture for the Phillo / Stunixx sample. Identity conflicts and low-confidence audio evidence are deliberately preserved for layout regression testing."};
const complete=structuredClone(fullAudioFixture);
complete.auditId="fixture-v2-complete-synthetic-only";
complete.evidence={...complete.evidence,fixture:true,verifiedComparables:[{title:"Fixture Comparable A",year:2024,lane:"Synthetic test lane",similarity:75,basis:"Test-only arrangement comparison",source:"fixture-only source"}],commercialMetrics:{verified:true,source:"fixture-only source",reportingPeriod:"fixture-only period",streams:100}};
complete.sonicDna={...complete.sonicDna,tempoConfidence:0.92,keyConfidence:0.88,keySegmentAgreement:0.9,energyConfidence:0.85,energyMethod:"fixture-only synthetic energy measure",structure:[{label:"Intro",startSeconds:0,endSeconds:12},{label:"Verse",startSeconds:12,endSeconds:42}],energyOverTime:[{timeSeconds:0,value:20},{timeSeconds:12,value:35},{timeSeconds:42,value:68}],sonicDnaAxes:Object.fromEntries(["Rhythm","Harmony","Texture","Vocal","Space"].map(name=>[name,{score:70,note:"Synthetic test-only axis value"}])),flaggedMoments:[{timestampSeconds:42,title:"Hook entry",note:"Synthetic test-only listening flag",tag:"Strength"}]};
const minimal=structuredClone(metadataOnlyFixture);
minimal.auditId="fixture-v2-minimal-audio-only";
minimal.evidence={fixture:true,auditType:"AUDIO-ONLY TEST FIXTURE",artist:null,title:null,album:null,isrc:null,upc:null,label:null,metadataSourcesChecked:[]};
minimal.sonicDna={provenance:"fixture-only uploaded audio",bpm:null,key:null,mode:null,tempoConfidence:0,keyConfidence:0};
for(const [name,input,expected] of [
 ["v2-phillo-stunixx-reference",phillo,8],
 ["v2-complete-synthetic-fixture",complete,8],
 ["v2-minimal-audio-only",minimal,8],
]){
 const bytes=await generateAuditReportV2({...input,generatedAt:"2026-11-20T00:00:00.000Z"});
 const pdf=await PDFDocument.load(bytes);
 if(pdf.getPageCount()!==expected)throw new Error(name+" expected "+expected+" pages; got "+pdf.getPageCount());
 const file=new URL(name+".pdf",out);
 await writeFile(file,bytes);
 const extracted=execFileSync("pdftotext",["-layout",file.pathname,"-"],{encoding:"utf8"});
 const extractedPages=extracted.split("\f").filter(page=>page.trim().length>0);
 if(/EVIDENCE AND LIMITATIONS|INSUFFICIENT EVIDENCE|NOT ESTABLISHED/i.test(extracted))throw new Error(name+" contains a forbidden dead-end verdict or limitations section");
 if(!extractedPages.at(-1)?.toUpperCase().includes("A&R NOTES"))throw new Error(name+" must finish with an A&R NOTES page");
 assertArNotes(pdf,name,extractedPages.at(-1)??"");
 process.stdout.write(name+": "+pdf.getPageCount()+" pages; final A&R notes and verdict checks passed.\n");
}


const philloFullBytes=await generateAuditReportV2({...phillo,generatedAt:"2026-11-20T00:00:00.000Z"},"full");
const philloFullPdf=await PDFDocument.load(philloFullBytes);
if(philloFullPdf.getPageCount()!==13)throw new Error("v2-phillo-stunixx-full expected 13 pages (7 core + 5 narrative + final A&R notes); got "+philloFullPdf.getPageCount());
const philloFullFile=new URL("v2-phillo-stunixx-full.pdf",out);
await writeFile(philloFullFile,philloFullBytes);
const philloFullText=execFileSync("pdftotext",["-layout",philloFullFile.pathname,"-"],{encoding:"utf8"});
const philloFullPages=philloFullText.split("\f").filter(page=>page.trim().length>0);
if(/EVIDENCE AND LIMITATIONS|INSUFFICIENT EVIDENCE|NOT ESTABLISHED|NOT CLEARED/i.test(philloFullText))throw new Error("Phillo full fixture contains a forbidden dead-end verdict or limitations section");
if(/No definitive platform-backed primary genre|Keep lane positioning unconfirmed/i.test(philloFullText))throw new Error("Phillo full fixture contains dead-end lane positioning copy");
if(!philloFullPages.at(-1)?.toUpperCase().includes("A&R NOTES"))throw new Error("Phillo full fixture must finish with A&R NOTES");
assertArNotes(philloFullPdf,"v2-phillo-stunixx-full",philloFullPages.at(-1)??"");
const normalizedPhilloText=philloFullText.replace(/\s+/g," ").toUpperCase().replace(/[–—]/g,"-");
if(!normalizedPhilloText.includes("DAYS 61")||normalizedPhilloText.includes("DAYS 61-90 NOT SUPPLIED")||!normalizedPhilloText.includes("CURATOR")||!normalizedPhilloText.includes("CREATOR")||!normalizedPhilloText.includes("ISRC")||!normalizedPhilloText.includes("PERFORMANCE REVIEW"))throw new Error("Phillo full fixture is missing its complete post-release Days 61-90 plan");
if(!normalizedPhilloText.includes("RELEASE DATE DETERMINED")||!normalizedPhilloText.includes("PRE-RELEASE STAGE (HISTORICAL; ALREADY PASSED)")||!normalizedPhilloText.includes("RELEASE WINDOW (HISTORICAL; ALREADY PASSED)")||!normalizedPhilloText.includes("POST-RELEASE GROWTH AND REACTIVATION"))throw new Error("Phillo fixture does not preserve determined post-release campaign framing");
if(normalizedPhilloText.includes("LOW- AUDIO EVIDENCE")||normalizedPhilloText.includes("HISTORICAL; ALREADY PASSED) (HISTORICAL")||normalizedPhilloText.includes("AUDIT-RELATIVE) · POST-RELEASE")||normalizedPhilloText.includes("KEEP LANE POSITIONING UNCONFIRMED"))throw new Error("Phillo fixture contains duplicated labels, dead-end lane wording or garbled confidence text");
process.stdout.write("v2-phillo-stunixx-full: "+philloFullPdf.getPageCount()+" pages; post-release execution and final A&R notes verified.\n");

const fullBytes=await generateAuditReportV2({...complete,generatedAt:"2026-11-20T00:00:00.000Z"},"full");
const fullPdf=await PDFDocument.load(fullBytes);
if(fullPdf.getPageCount()!==14)throw new Error("v2-complete-synthetic-full expected 14 pages (7 core + 5 narrative + 1 evidence-gated deep dive + final A&R notes); got "+fullPdf.getPageCount());
await writeFile(new URL("v2-complete-synthetic-full.pdf",out),fullBytes);
const fullText=execFileSync("pdftotext",["-layout",new URL("v2-complete-synthetic-full.pdf",out).pathname,"-"],{encoding:"utf8"});
const fullPages=fullText.split("\f").filter(page=>page.trim().length>0);
assertArNotes(fullPdf,"v2-complete-synthetic-full",fullPages.at(-1)??"");
process.stdout.write("v2-complete-synthetic-full: "+fullPdf.getPageCount()+" pages; fixed full-report allocation verified.\n");


const audit618=JSON.parse(await readFile(new URL("../tests/fixtures/audit-618b9b7a-sanitized.json",import.meta.url),"utf8"));
if(audit618.auditId!=="618b9b7a-5c0c-4acf-a583-f0e4e0f58a3b")throw new Error("The persisted audit fixture ID does not match 618b9b7a");
audit618.marketPlacement=buildMarketPlacementPlan({
 executionMode:audit618.executionMode,
 evidence:audit618.evidence,
 sonicDna:audit618.sonicDna,
 playlistDiscovery:audit618.evidence.playlistDiscovery,
});
audit618.decisionDimensions=adaptReportV2(audit618).decisionDimensions;
const expectedAudit618Dimensions=[
 {name:"Audio",label:"AUDIO",status:"MEASURED"},
 {name:"Identity",label:"IDENTITY",status:"CONFLICTS OPEN"},
 {name:"Market",label:"MARKET",status:"PROPOSED"},
 {name:"Release readiness",label:"RELEASE READINESS",status:"PENDING RIGHTS CHECKS"},
];
for(const expected of expectedAudit618Dimensions){
 const actual=String(audit618.decisionDimensions.find(dimension=>dimension.name===expected.name)?.status??"").toUpperCase();
 if(actual!==expected.status)throw new Error("Audit 618b9b7a "+expected.name+" verdict mismatch: expected "+expected.status+", received "+actual);
}
if(audit618.marketPlacement?.isrcStrategy?.route!=="ISRC_FIRST"||audit618.marketPlacement?.isrcStrategy?.isrc!=="USSM10501515")throw new Error("Audit 618b9b7a must take the validated ISRC-first market-data route");
for(const [tier,suffix,minPages] of [["sample","sample",8],["full","full",13]]){
 const bytes=tier==="sample"
  ?await generateAuditReportV2({...audit618,generatedAt:audit618.generatedAt})
  :await generateAuditReportV2({...audit618,generatedAt:audit618.generatedAt},"full");
 const pdf=await PDFDocument.load(bytes);
 if(pdf.getPageCount()<minPages)throw new Error("Audit 618b9b7a "+tier+" PDF unexpectedly has only "+pdf.getPageCount()+" pages");
 const file=new URL("audit-618b9b7a-"+suffix+".pdf",out);
 await writeFile(file,bytes);
 const extracted=execFileSync("pdftotext",["-layout",file.pathname,"-"],{encoding:"utf8"});
 const pages=extracted.split("\f").filter(page=>page.trim().length>0);
 const notesPage=pages.at(-1)??"";
 assertArNotes(pdf,"audit-618b9b7a-"+tier,notesPage);
 const normalized=notesPage.replace(/\s+/g," ").toUpperCase();
 for(const {label,status} of expectedAudit618Dimensions){
  if(!normalized.includes(label)||!normalized.includes(status))throw new Error("Audit 618b9b7a "+tier+" A&R Notes chip is missing persisted "+label+" verdict: "+status);
 }
 if(!/55\s*BPM/i.test(extracted)||!/UNCONFIRMED/i.test(extracted)||/\b(?:Confirmed|Measured) tempo:\s*55\s*BPM/i.test(extracted))throw new Error("Audit 618b9b7a "+tier+" PDF must preserve the 55 BPM candidate as unconfirmed");
 if(!/PROVISIONAL/i.test(extracted)||!/F#/i.test(extracted))throw new Error("Audit 618b9b7a "+tier+" PDF must preserve provisional tonal candidates");
 if(/\b\d[\d,]*\s*(?:streams|listeners|saves|sales|revenue)\b/i.test(extracted))throw new Error("Audit 618b9b7a "+tier+" PDF invented unsupported market-performance metrics");
 process.stdout.write("audit-618b9b7a-"+tier+": "+pdf.getPageCount()+" pages; persisted verdict chips, ISRC route, audio abstention and final A&R Notes verified.\n");
}
