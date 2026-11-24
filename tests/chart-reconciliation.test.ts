import { describe, expect, it } from "vitest";
import { reconcileChartCrossChecks, reconcileChartSeriesAndLabels } from "../src/reports/chart-reconciliation.js";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { chartPanelDisplayStatus, drawChartPanel, draw3DSolidBar, draw3DSolidSphere, type ChartKind } from "../src/reports/charts.js";

describe("chart data and label reconciliation",()=>{
 it("keeps exact reconciled counts and cleans internal labels",()=>{
  const result=reconcileChartSeriesAndLabels({rows:[
   {label:"Strengths",value:3},{label:"Risks",value:4},
   {label:"Genre direction · working direction · platform source not supplied",value:null},
   {label:"ISTENER ACTION",value:null}
  ],provenance:"ASSESSMENT-RECONCILED"});
  expect(result.rows.map(row=>row.label)).toEqual(["Strengths","Risks"]);
  expect(result.rows.map(row=>row.value)).toEqual([3,4]);
  expect(result.total).toBe(7);
  expect(result.provenance).toBe("ASSESSMENT-RECONCILED");
 });
 it("adds missing required categories without inventing their counts",()=>{
  const result=reconcileChartSeriesAndLabels({rows:[{label:"Measured",value:2}],expectedLabels:["Measured","Cross-Checked","Source Matches","Hypotheses"],endpointAvailable:false});
  expect(result.rows).toHaveLength(4);
  expect(result.rows.slice(1).every(row=>row.value===null)).toBe(true);
  expect(result.state).toBe("ENDPOINT_PENDING");
  expect(result.note).toContain("no external value is inferred");
 });
 it("marks in-process coarse metrics and proposed commercial data explicitly",()=>{
  expect(reconcileChartSeriesAndLabels({rows:[{label:"RMS Energy",value:.42}],derivedInProcess:true}).state).toBe("SIGNAL-DERIVED");
  expect(reconcileChartSeriesAndLabels({rows:[{label:"Audience demand",value:null}],proposed:true}).provenance).toContain("PROPOSED");
 });
 it("promotes voting-stabilized tonal findings to an explicit CONFIRMED chart state",()=>{
  const result=reconcileChartSeriesAndLabels({rows:[{label:"Key / mode",value:"C major · CONFIRMED"}],metricAvailable:true,confirmed:true});
  expect(result.state).toBe("CONFIRMED");
  expect(result.provenance).toContain("VOTING-STABILIZED");
 });
 it("labels missing dedicated endpoints and provisional chart states without inventing values",()=>{
  const pending=reconcileChartSeriesAndLabels({rows:[{label:"Loudness time series",value:null}],endpointAvailable:false,metricAvailable:false});
  const proposed=reconcileChartSeriesAndLabels({rows:[{label:"Audience demand",value:null}],proposed:true});
  expect(pending.state).toBe("ENDPOINT_PENDING");
  expect(proposed.state).toBe("PROPOSED");
  expect(pending.rows[0].value).toBeNull();
  expect(proposed.rows[0].value).toBeNull();
 });
 it("surfaces reconciled provenance states as compact chart badges",()=>{
  expect(chartPanelDisplayStatus({fixture:false,inferred:false,unavailable:false,evidenceClass:"measured",chartState:"CONFIRMED"})).toBe("CONFIRMED");
  expect(chartPanelDisplayStatus({fixture:false,inferred:false,unavailable:false,evidenceClass:"measured",chartState:"SIGNAL-DERIVED"})).toBe("SIGNAL-DERIVED");
  expect(chartPanelDisplayStatus({fixture:false,inferred:true,unavailable:false,evidenceClass:"inferred",chartState:"PROPOSED"})).toBe("PROPOSED");
  expect(chartPanelDisplayStatus({fixture:false,inferred:false,unavailable:true,evidenceClass:"provider-recognized",chartState:"ENDPOINT_PENDING"})).toBe("ENDPOINT PENDING");
 });
 it("never fabricates an axis scale when all values are missing",()=>{
  const result=reconcileChartSeriesAndLabels({rows:[{label:"Tempo",value:"Not determined"}],metricAvailable:false});
  expect(result.total).toBeNull();
  expect(result.axisTicks).toEqual([0,1]);
  expect(result.rows[0].value).toBeNull();
 });
 it("flags platform, evidence, SWOT and missing 90-day cross-chart drift",()=>{
  expect(reconcileChartCrossChecks({platformLookupCount:3,platformChartCount:2,evidenceClaimCount:5,evidenceChartCount:5,strengthCount:3,strengthChartCount:3,riskCount:4,riskChartCount:4,executionLabels:["Days 1–30","Days 31–60"]})).toEqual([
   "Music Platform Coverage chart count does not match reconciled source count.",
   "30/60/90-day execution timeline is missing a required milestone window."
  ]);
 });
 it("accepts reconciled provider/evidence/strength totals and requires all three execution windows",()=>{
  expect(reconcileChartCrossChecks({platformLookupCount:4,platformChartCount:4,evidenceClaimCount:7,evidenceChartCount:7,strengthCount:12,strengthChartCount:12,riskCount:2,riskChartCount:2,executionLabels:["Days 1–30","Days 31–60","Days 61–90"]})).toEqual([]);
 });
 it("renders the reconciled series as deterministic vector output without changing the chart container",async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([612,792]);
  expect(()=>drawChartPanel(page,{title:"Reconciled strengths and risks",kind:"tension",rows:[{label:"Strengths",value:3},{label:"Risks",value:4},{label:"Clear hook",value:null,group:"strength"},{label:"Metadata conflict",value:null,group:"risk"}],shows:"Exact assessment count",cantShow:"Commercial outcomes",evidenceClass:"assessment-derived",evidenceRefs:["assessment.swot"]},font,bold)).not.toThrow();
  const bytes=await pdf.save();expect(bytes.length).toBeGreaterThan(1000);
 });
 it("renders every supported chart family with the native 3D vector system",async()=>{
  const kinds:ChartKind[]=["bars","sonic","spectrum","constellation","layers","tension","timeline","chain","radar"];
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const kind of kinds){
   const page=pdf.addPage([612,792]);
   expect(()=>drawChartPanel(page,{title:"3D "+kind,kind,rows:[
    {label:"Tempo BPM · CONFIRMED",value:120},{label:"Signal energy dBFS",value:-12.4},
    {label:"Strengths",value:3},{label:"Risks",value:4},{label:"Days 1–30",value:null},
    {label:"Days 31–60",value:null},{label:"Days 61–90",value:null}
   ],shows:"Reconciled source values",cantShow:"Unmeasured commercial demand",evidenceClass:"measured",evidenceRefs:["sonicDna.audioMetrics"]},font,bold)).not.toThrow();
  }
  const page=pdf.addPage([612,792]);
  expect(()=>{draw3DSolidBar(page,60,100,180,12,rgb(.2,.4,.8));draw3DSolidSphere(page,280,110,12,rgb(.2,.4,.8));}).not.toThrow();
  expect((await pdf.save()).length).toBeGreaterThan(5000);
 });

});
