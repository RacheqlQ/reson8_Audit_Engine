import { PDFDocument } from "@cantoo/pdf-lib";
import { describe,expect,it } from "vitest";
import { checkLayout,checkPageDensity,chartLayoutIssuesForReport,generateAuditReport,planAuditReportPages,type AuditReportInput } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture,partialAudioFixture,metadataOnlyFixture,longFormAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
const fixtures=[fullAudioFixture,partialAudioFixture,metadataOnlyFixture,longFormAudioFixture] as unknown as AuditReportInput[];
describe("A4 report layout and fixture coverage",()=>{
 it("detects element intersections and page overflow",()=>{
  expect(checkLayout([{x:0,y:0,width:20,height:20,id:"a"},{x:10,y:10,width:20,height:20,id:"b"}]).ok).toBe(false);
  expect(checkLayout([{x:590,y:0,width:20,height:20,id:"overflow"}]).ok).toBe(false);
 });
 it("enforces the 35 percent maximum empty-area threshold",()=>{
  expect(checkPageDensity([{x:48,y:76,width:499,height:659,id:"dense"}]).ok).toBe(true);
  expect(checkPageDensity([{x:48,y:600,width:499,height:100,id:"sparse"}]).ok).toBe(false);
  expect(checkPageDensity([],true).ok).toBe(true);
 });
 it("checks chart-caption separation for every chart in all four fixtures",()=>{\n  for(const input of fixtures)expect(chartLayoutIssuesForReport(input)).toEqual([]);\n });\n it("renders each fixture pair at A4 with exactly one isolated A&R notes field",async()=>{
  for(const input of fixtures)for(const tier of ["sample","full"] as const){
   const bytes=await generateAuditReport(input,tier),pdf=await PDFDocument.load(bytes);
   for(const page of pdf.getPages()){const size=page.getSize();expect(size.width).toBeCloseTo(595.28,0);expect(size.height).toBeCloseTo(841.89,0);}
   expect(pdf.getForm().getFields().map(f=>f.getName())).toEqual(["ar_notes"]);
   expect(pdf.getPageCount()).toBeLessThanOrEqual(20);
  }
 });
 it("marks the audio fixture variants as synthetic, including partial null-key and low-confidence data",()=>{
  expect(fullAudioFixture.evidence.artist).toBe("Fixture Artist");
  expect(fullAudioFixture.sonicDna.bpm).toBe(96);
  expect(partialAudioFixture.sonicDna.key).toBeNull();
  expect(partialAudioFixture.assessment.confidence).toBe(0.28);
  expect(metadataOnlyFixture.sonicDna).toBeNull();
  expect(metadataOnlyFixture.evidence.artist).toBe("Fixture Artist");
  expect(longFormAudioFixture.evidence.fixture).toBe(true);
  expect(longFormAudioFixture.assessment.executiveSummary.split(/\s+/).length).toBeGreaterThan(70);
  expect(longFormAudioFixture.assessment.strengths.length).toBeGreaterThanOrEqual(4);
 });
 it("uses evidence-derived dimensions and keeps artistic judgement unscored",()=>{
  const pages=planAuditReportPages(fixtures[0],"full");
  const report=pages.flatMap(p=>[p.title,...p.text]).join(" ");
  expect(report).toContain("Tempo and lane fit");expect(report).toContain("Rhythmic consistency");
  expect(report).toContain("Dynamic range and loudness readiness");expect(report).toContain("Human listening checklist");
  expect(report).toContain("INDUSTRY PRACTICE");expect(report).toContain("references to verify");
 });
 it("collapses all missing audio measurements into one empty state",()=>{
  const report=planAuditReportPages(fixtures[2],"full").flatMap(p=>p.text).join(" ");
  expect(report).toContain("Not measured: no master audio supplied.");
  expect(report).not.toContain("Key / mode: Not measured");
 });
});
