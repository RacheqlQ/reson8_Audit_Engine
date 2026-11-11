import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildStrengthRiskChartRows, strengthRiskItemsForColumn, chartPanelHeight, chartPanelLayoutErrors, chartPanelLayoutRects, chartShapeBoundsErrors, countEvidenceLayers, drawChartPanel, wrapChartSummary, type ChartKind, type ChartRow } from "../src/reports/charts.js";
import { checkLayout } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture, sampleReportInput } from "../scripts/fixtures/sample-report-input.mjs";

describe("native PDF chart helpers", () => {
  it("renders complete, partial and null data without throwing", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([612, 792]);

    expect(() => drawChartPanel(page, {
      title: "Full data", kind: "layers",
      rows: [
        { label: "OBSERVED", value: 3, proportion: 0.5 },
        { label: "RECOGNIZED", value: 1, proportion: 0.17 },
        { label: "RECONCILED", value: 1, proportion: 0.17 },
        { label: "INFERRED", value: 1, proportion: 0.16 },
      ],
      shows: "real evidence counts", cantShow: "claim truth",
    }, font, bold)).not.toThrow();

    expect(() => drawChartPanel(page, {
      title: "Partial data", kind: "sonic",
      rows: [{ label: "BPM", value: 96 }, { label: "Key", value: null }],
      shows: "available fields", cantShow: "missing measurements",
    }, font, bold)).not.toThrow();

    expect(() => drawChartPanel(page, {
      title: "Evidence scorecard", kind: "radar",
      rows: [{ label: "Tempo / lane fit", value: 78 }, { label: "Rhythmic consistency", value: 82 },
        { label: "Dynamic / loudness", value: 74 }, { label: "Metadata", value: 80 }, { label: "Release readiness", value: null }],
      shows: "supported evidence-derived scores", cantShow: "artistic taste or unmeasured outcomes",
    }, font, bold)).not.toThrow();

    expect(() => drawChartPanel(page, {
      title: "Null data", kind: "spectrum",
      rows: [{ label: "Energy", value: null }, { label: "Tempo", value: undefined }],
      shows: "supplied values", cantShow: "unknown values",
    }, font, bold)).not.toThrow();

    const nullRows=[{label:"Null metric",value:null},{label:"Missing metric",value:undefined}];
    for(const kind of ["bars","sonic","spectrum","constellation","layers","tension","timeline","chain","radar"] as const){
      const nullPage=pdf.addPage([595.28,841.89]);
      expect(()=>drawChartPanel(nullPage,{title:"Null "+kind,kind,rows:nullRows,shows:"no supplied values",cantShow:"unknown measurements"},font,bold)).not.toThrow();
    }
    expect(await pdf.save()).toBeInstanceOf(Uint8Array);
  });


  it("keeps every chart drawing footprint inside its own card for all four fixtures and all chart types", () => {
    const kinds: ChartKind[] = ["bars","sonic","spectrum","constellation","layers","tension","timeline","chain","radar"];
    const fixtures = [fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture];
    for (const fixture of fixtures) {
      const sonic = fixture.sonicDna;
      const standardRows: ChartRow[] = [
        {label:"TEMPO",value:sonic?.bpm??null},
        {label:"RMS ENERGY",value:sonic?.rmsEnergy??null},
        {label:"DYNAMIC RANGE",value:sonic?.dynamicRangeDb??null},
        {label:"Rhythmic consistency",value:78},
        {label:"Release readiness",value:null},
        {label:"Metadata completeness",value:91},
      ];
      const tensionRows: ChartRow[] = [
        {label:"Strengths",value:10},{label:"Risks",value:10},
        ...buildStrengthRiskChartRows(
          Array.from({length:fixture.assessment.strengths.length},(_,i)=>"A documented strength with enough words to exercise safe two-line wrapping "+(i+1)),
          Array.from({length:fixture.assessment.risks.length},(_,i)=>"A documented risk with enough words to exercise safe two-line wrapping "+(i+1)),
        ),
      ];
      for (const kind of kinds) {
        const rows = kind==="tension" ? tensionRows : standardRows;
        expect(chartPanelLayoutErrors(kind,rows,48,700,chartPanelHeight(kind,rows))).toEqual([]);
        const rects=chartPanelLayoutRects(kind,rows,48,700,chartPanelHeight(kind,rows));
        const card=rects.find(rect=>rect.id==="card-bounds");
        expect(card).toBeDefined();
        if(card)expect(chartShapeBoundsErrors(card,rects.filter(rect=>rect.id.startsWith("shape-")||rect.id.startsWith("label-")))).toEqual([]);
        if(card)expect(checkLayout([card,{x:card.x+12,y:card.y+12,width:80,height:18,id:"overlapping-page-paragraph"}]).ok).toBe(false);
      }
    }
  });


  it("keeps planned Strengths and Risks content in their own columns for every fixture, including four-item long-form lists", () => {
    for (const fixture of [fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture]) {
      const rows = buildStrengthRiskChartRows(fixture.assessment.strengths, fixture.assessment.risks);
      const strengths = strengthRiskItemsForColumn(rows, "strength");
      const risks = strengthRiskItemsForColumn(rows, "risk");

      expect(strengths.map(row => row.label)).toEqual(fixture.assessment.strengths);
      expect(risks.map(row => row.label)).toEqual(fixture.assessment.risks);
      expect(strengths.every(row => row.group === "strength")).toBe(true);
      expect(risks.every(row => row.group === "risk")).toBe(true);
      expect(strengths.some(row => fixture.assessment.risks.includes(row.label))).toBe(false);
      expect(risks.some(row => fixture.assessment.strengths.includes(row.label))).toBe(false);
    }

    expect(longFormAudioFixture.assessment.strengths).toHaveLength(4);
    expect(longFormAudioFixture.assessment.risks).toHaveLength(4);
  });

  it("wraps Strengths/Risks summaries to two complete-word lines at readable size", async () => {
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
    const source="A substantial documented strength with multiple meaningful words that must be shortened only at a complete word boundary when the chart column is full.";
    const lines=wrapChartSummary(source,font,7.5,186,2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[1]).toMatch(/…$/);
    const shown=lines.join(" ").replace("…","").split(/\s+/);
    expect(source.split(/\s+/).slice(0,shown.length)).toEqual(shown);
  });

  it("rejects the legacy Strengths/Risks column geometry that escaped above the card", () => {
    const card = {x:48,y:310,width:499,height:390,id:"card-bounds"};
    const legacyColumn = {x:62,y:637,width:220,height:286,id:"legacy-tension-column"};
    expect(chartShapeBoundsErrors(card,[legacyColumn])).toContain("Chart shape outside card: legacy-tension-column");
  });

  it("renders the long-form fixture with full-length chart captions and narrative content", async () => {
    const pdf=await PDFDocument.create();
    const font=await pdf.embedFont(StandardFonts.Helvetica);
    const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const page=pdf.addPage([595.28,841.89]);
    expect(longFormAudioFixture.evidence.fixture).toBe(true);
    expect(()=>drawChartPanel(page,{title:"Long-form evidence",kind:"layers",rows:[{label:"OBSERVED",value:3},{label:"RECOGNIZED",value:1},{label:"RECONCILED",value:2},{label:"INFERRED",value:4}],shows:"A complete set of source-labelled claims with multiple independently attributed fields.",cantShow:"Truth, completeness, commercial relevance or listener response."},font,bold)).not.toThrow();
  });

  it("counts evidence layers exactly from the supplied labels", () => {
    expect(countEvidenceLayers([
      { label: "OBSERVED" },
      { label: "RECOGNIZED" },
      { label: "INFERRED" },
      { label: "INFERRED" },
    ])).toEqual({ OBSERVED: 1, RECOGNIZED: 1, RECONCILED: 0, INFERRED: 2 });
  });

  it("matches the evidence-layer counts in the sample report fixture", () => {
    expect(countEvidenceLayers(sampleReportInput.assessment.evidenceLabels)).toEqual({
      OBSERVED: 1,
      RECOGNIZED: 1,
      RECONCILED: 0,
      INFERRED: 1,
    });
  });

});
