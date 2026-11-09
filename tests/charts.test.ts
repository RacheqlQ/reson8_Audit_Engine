import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { countEvidenceLayers, drawChartPanel } from "../src/reports/charts.js";
import { longFormAudioFixture, sampleReportInput } from "../scripts/fixtures/sample-report-input.mjs";

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

    const nullRows=[{label:"Null metric",value:null},{label:"Missing metric",value:undefined}];\n    for(const kind of ["bars","sonic","spectrum","constellation","layers","tension","timeline","chain","radar"] as const){\n      const nullPage=pdf.addPage([595.28,841.89]);\n      expect(()=>drawChartPanel(nullPage,{title:"Null "+kind,kind,rows:nullRows,shows:"no supplied values",cantShow:"unknown measurements"},font,bold)).not.toThrow();\n    }\n    expect(await pdf.save()).toBeInstanceOf(Uint8Array);
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
