import { PDFDocument } from "@cantoo/pdf-lib";
import { describe,expect,it } from "vitest";
import { checkLayout,generateAuditReport,planAuditReportPages,type AuditReportInput } from "../src/reports/generate-audit-report.js";
const input={
 auditId:"fixture",generatedAt:"2026-11-09T00:00:00.000Z",
 evidence:{artist:"Fixture Artist",title:"Fixture Track",auditType:"METADATA-BASED AUDIT",isrc:"NGABC2600001",sources:["catalog fixture"]},
 sonicDna:null,
 assessment:{
 assessmentVersion:"3.0",executiveSummary:"A metadata-led preliminary assessment. No uploaded master or audience telemetry is included. The report separates observed identity evidence from inferred positioning and general industry practice.",
 creativeIdentity:"A provisional lane hypothesis requiring full-master listening before external use.",
 strengths:["Identity fields are present for review.","The source record is traceable.","A release brief can be prepared after verification."],
 risks:["No uploaded master is available.","No verified audience performance evidence is supplied."],
 aAndRPositioning:{primaryLane:"R&B",adjacentLanes:["Alternative R&B"],rationale:"A discovery hypothesis only; verify by listening."},
 commercialRead:{marketability:"undetermined",rationale:"No verified commercial performance evidence was supplied."},
 releaseStrategy:{recommendation:"Complete the evidence gates before campaign spend.",priorities:["Verify master and rights.","Reconcile release metadata.","Review platform analytics when available."]},
 evidenceGaps:["No audio master or audience telemetry."],confidence:.45,limitations:["Metadata-only fixture."],
 scorecard:{
 sonicIdentity:{score:null,rationale:"No master audio."},metadataIntegrity:{score:70,rationale:"Partial metadata coverage."},
 commercialEvidence:{score:null,rationale:"No commercial evidence."},releaseReadiness:{score:40,rationale:"Open checks remain."},
 hook:{score:null,rationale:"Human listening required."},originality:{score:null,rationale:"Human listening required."},production:{score:null,rationale:"Human listening required."},replayValue:{score:null,rationale:"Listener evidence required."},laneClarity:{score:null,rationale:"Human listening required."}
 },
 evidenceLabels:[{label:"RECOGNIZED",claim:"Identity represented in fixture catalog data.",source:"fixture"}]
 }
} as unknown as AuditReportInput;
describe("A4 report layout",()=>{
 it("detects overflow and intersecting elements",()=>{
  expect(checkLayout([{x:0,y:0,width:20,height:20,id:"a"},{x:10,y:10,width:20,height:20,id:"b"}]).ok).toBe(false);
  expect(checkLayout([{x:590,y:0,width:20,height:20,id:"overflow"}]).ok).toBe(false);
 });
 it("creates an A4 PDF with only the isolated A&R notes field",async()=>{
  const bytes=await generateAuditReport(input,"full"),pdf=await PDFDocument.load(bytes);
  const size=pdf.getPages()[0].getSize();
  expect(size.width).toBeCloseTo(595.28,0);expect(size.height).toBeCloseTo(841.89,0);
  expect(pdf.getForm().getFields().map(f=>f.getName())).toEqual(["ar_notes"]);
 });
 it("keeps missing audio as one consolidated empty state",()=>{
  const text=planAuditReportPages(input,"full").flatMap(p=>p.text).join(" ");
  expect(text).toContain("Not measured: no master audio supplied.");
  expect(text).toContain("INDUSTRY PRACTICE");
  expect(text).toContain("Human listening checklist");
 });
});
