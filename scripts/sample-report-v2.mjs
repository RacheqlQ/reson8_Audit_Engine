import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReportV2 } from "../dist/reports/v2/render.js";
import { ambiguousAudioFixture } from "./fixtures/ambiguous-audio.mjs";
import { fullAudioFixture, metadataOnlyFixture } from "./fixtures/sample-report-input.mjs";

const out=new URL("../artifacts/",import.meta.url);
await mkdir(out,{recursive:true});
const phillo=structuredClone(ambiguousAudioFixture);
phillo.auditId="fixture-phillo-stunixx-low-confidence";
phillo.evidence={...phillo.evidence,artist:"Stunixx",title:"Phillo",album:null,isrc:null,upc:null,label:null,genre:null,reconciliation:{conflicts:[{field:"album",values:["Hole-Hearted - EP","Hole-Hearted"]}]}};
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
 const extractedPages=extracted.split("\\f").filter(page=>page.trim().length>0);
 if(/EVIDENCE AND LIMITATIONS|INSUFFICIENT EVIDENCE|NOT ESTABLISHED/i.test(extracted))throw new Error(name+" contains a forbidden dead-end verdict or limitations section");
 if(!extractedPages.at(-1)?.toUpperCase().includes("A&R NOTES"))throw new Error(name+" must finish with an A&R NOTES page");
 process.stdout.write(name+": "+pdf.getPageCount()+" pages; final A&R notes and verdict checks passed.\\n");
}


const philloFullBytes=await generateAuditReportV2({...phillo,generatedAt:"2026-11-20T00:00:00.000Z"},"full");
const philloFullPdf=await PDFDocument.load(philloFullBytes);
if(philloFullPdf.getPageCount()!==15)throw new Error("v2-phillo-stunixx-full expected 15 pages including five narrative pages, an evidence-gated deep dive and final A&R notes; got "+philloFullPdf.getPageCount());
const philloFullFile=new URL("v2-phillo-stunixx-full.pdf",out);
await writeFile(philloFullFile,philloFullBytes);
const philloFullText=execFileSync("pdftotext",["-layout",philloFullFile.pathname,"-"],{encoding:"utf8"});
const philloFullPages=philloFullText.split("\\f").filter(page=>page.trim().length>0);
if(/EVIDENCE AND LIMITATIONS|INSUFFICIENT EVIDENCE|NOT ESTABLISHED/i.test(philloFullText))throw new Error("Phillo full fixture contains a forbidden dead-end verdict or limitations section");
if(!philloFullPages.at(-1)?.toUpperCase().includes("A&R NOTES"))throw new Error("Phillo full fixture must finish with A&R NOTES");
const executionPage=philloFullPages.find(page=>page.toUpperCase().includes("30 / 60 / 90-DAY EXECUTION PLAN"));
if(!executionPage||!executionPage.toUpperCase().includes("DAYS 61-90"))throw new Error("Phillo full fixture is missing its Days 61-90 plan");
process.stdout.write("v2-phillo-stunixx-full: "+philloFullPdf.getPageCount()+" pages; post-release execution and final A&R notes verified.\\n");

const fullBytes=await generateAuditReportV2({...complete,generatedAt:"2026-11-20T00:00:00.000Z"},"full");
const fullPdf=await PDFDocument.load(fullBytes);
if(fullPdf.getPageCount()!==16)throw new Error("v2-complete-synthetic-full expected 16 pages (9 base + 5 narrative + 2 evidence-gated deep dives); got "+fullPdf.getPageCount());
await writeFile(new URL("v2-complete-synthetic-full.pdf",out),fullBytes);
process.stdout.write("v2-complete-synthetic-full: "+fullPdf.getPageCount()+" pages; fixed full-report allocation verified.\\n");
