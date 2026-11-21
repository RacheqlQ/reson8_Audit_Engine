import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildStrengthRiskChartRows, compactChartItemSummary, parseChartMetricValue, strengthRiskItemsForColumn, chartPanelStatus, chartPanelDisplayStatus, chartEvidenceIntegrityErrors, chartPanelHeight, chartPanelLayoutErrors, chartPanelLayoutRects, chartShapeBoundsErrors, countEvidenceLayers, drawChartPanel, radarScoreDisplayValue, wrapChartSummary, type ChartKind, type ChartRow } from "../src/reports/charts.js";
import { checkLayout } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture, sampleReportInput } from "../scripts/fixtures/sample-report-input.mjs";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";

describe("native PDF chart helpers", () => {
  it("labels unavailable evidence-scorecard dimensions as not scored, not N/D", () => {
    expect(radarScoreDisplayValue(null)).toBe("NOT SCORED");
    expect(radarScoreDisplayValue(Number.NaN)).toBe("NOT SCORED");
    expect(radarScoreDisplayValue(0)).toBe("0");
    expect(radarScoreDisplayValue(82.7)).toBe("83");
  });

  it("parses numeric strings for measured dashboard values and rejects labels", () => {
    expect(parseChartMetricValue("13.1")).toBe(13.1);
    expect(parseChartMetricValue("-10.6")).toBe(-10.6);
    expect(parseChartMetricValue("Not supplied")).toBeNull();
    expect(parseChartMetricValue("C major")).toBeNull();
    expect(parseChartMetricValue(null)).toBeNull();
  });

  it("renders fixture status and underlying evidence class independently", () => {
    const classes = [
      ["measured", "MEASURED"],
      ["provider-recognized", "PROVIDER-RECOGNIZED"],
      ["inferred", "HYPOTHESIS"],
      ["assessment-derived", "A&R REVIEW"],
      ["illustrative", "ILLUSTRATIVE"],
    ] as const;
    expect(chartPanelStatus({ fixture: false })).toBe("UNCLASSIFIED");
    for (const [evidenceClass, label] of classes) {
      expect(chartPanelStatus({ evidenceClass })).toBe(label);
      const publicLabels: Record<string, string> = {
        measured: "MEASURED FROM RECORDING",
        "provider-recognized": "MUSIC PLATFORM RESULTS",
        inferred: "WORKING DIRECTION",
        "assessment-derived": "A&R REVIEW",
        illustrative: "ILLUSTRATIVE",
      };
      expect(chartPanelDisplayStatus({ evidenceClass })).toBe(publicLabels[evidenceClass]);
      const display = chartPanelDisplayStatus({ fixture: true, evidenceClass });
      expect(display).toContain("SAMPLE DATA · AUDIO REQUIRED");
      expect(display).toBe("SAMPLE DATA · AUDIO REQUIRED");
    }
    expect(chartPanelDisplayStatus({ fixture: true, unavailable: true, evidenceClass: "measured" }))
      .toBe("SAMPLE DATA · AUDIO REQUIRED");
    expect(chartPanelDisplayStatus({ unavailable: true, evidenceClass: "provider-recognized" }))
      .toBe("NOT AVAILABLE");
  });

  it("preserves full assessment text while supplying concise chart-only item summaries", () => {
    const strength = "The vocal performance carries a distinctive melodic contour and clear emotional intent across the central hook.";
    const risk = "The second verse repeats the same rhythmic pattern for too long and needs a deliberate arrangement contrast.";
    const rows = buildStrengthRiskChartRows([strength], [risk]);
    expect(rows[2].label).toBe(strength);
    expect(rows[2].summary).toBe(compactChartItemSummary(strength));
    expect(rows[2].summary!.length).toBeLessThan(strength.length);
    expect(rows[3].label).toBe(risk);
    expect(rows[3].summary!.length).toBeLessThan(risk.length);
  });

  it("keeps the generic ambiguous-audio fixture aligned with the abstaining estimator", () => {
    expect(ambiguousAudioFixture.evidence.fixture).toBe(true);
    expect(ambiguousAudioFixture.sonicDna.rhythmFeatures).toMatchObject({
      status: "insufficient_evidence",
      method: "high_frequency_transient_autocorrelation",
      confidence: 0,
    });
    expect(ambiguousAudioFixture.sonicDna.rhythmFeatures.abstentionReason).toContain("withheld");
  });

  it("does not draw a numeric BPM scale when the tempo value is withheld", () => {
    const rows: ChartRow[] = [
      { label: "TEMPO", value: null },
      { label: "RMS ENERGY", value: 0.42 },
      { label: "DYNAMIC RANGE", value: 8.5 },
    ];
    const rects = chartPanelLayoutRects("spectrum", rows, 48, 700, chartPanelHeight("spectrum", rows));
    expect(rects.some((rect) => rect.id === "label-spectrum-scale-0")).toBe(false);
    expect(rects.some((rect) => rect.id === "shape-spectrum-gradient-track-0")).toBe(false);
    expect(rects.some((rect) => rect.id === "label-spectrum-value-0")).toBe(true);
  });

  it("keeps the expanded Sonic DNA dashboard rows, including alternate tempo and provisional tuning evidence, inside the dashboard card", async () => {
    const rows: ChartRow[] = Array.from({length:13},(_,index)=>({
      label:["TEMPO BPM","TEMPO ALTERNATE INTERPRETATION","TEMPO CANDIDATE BPM","TEMPO DETECTION REASON","TEMPO WINDOW CONSENSUS","BEAT GRID STATUS","BEAT TIMESTAMP COUNT","KEY / MODE","KEY / MODE CANDIDATES","KEY WINDOW CONSENSUS","KEY CONFIDENCE DIAGNOSTIC","KEY CANDIDATE REASON","TUNING OFFSET CANDIDATE CENTS"][index],
      value:index===0?"96.0":index===7?"A minor":index===12?"14 (multiple tonal windows; provisional)":index===8?"C major":index===1?"48 BPM (half-time interpretation; alternate metrical level)":"Not determined",
    }));
    const height=chartPanelHeight("sonic",rows);
    const rects=chartPanelLayoutRects("sonic",rows,48,700,height);
    const card=rects.find(rect=>rect.id==="card-bounds");
    expect(height).toBe(340);
    expect(rects.filter(rect=>rect.id.startsWith("shape-sonic-metric-"))).toHaveLength(13);
    expect(chartPanelLayoutErrors("sonic",rows,48,700,height)).toEqual([]);
    expect(card).toBeDefined();
    if(card)expect(chartShapeBoundsErrors(card,rects.filter(rect=>rect.id.startsWith("shape-sonic-metric-")))).toEqual([]);
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const page=pdf.addPage([595.28,841.89]);
    expect(()=>drawChartPanel(page,{title:"Sonic DNA dashboard",kind:"sonic",rows,shows:"Confirmed and provisional audio metrics",cantShow:"Audience demand or commercial performance"},font,bold)).not.toThrow();
  });

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


  it("keeps complete constellation labels legible in narrow and boundary-aligned chart areas", async () => {
    const rows: ChartRow[] = [
      { label: "Primary lane", value: "A very long primary creative lane label that must remain complete without shortening or silent truncation" },
      { label: "Adjacent lane", value: "A second extended adjacent lane label with several words and enough length to wrap across multiple lines" },
      { label: "Adjacent lane", value: "A third boundary-case label with an exceptionallylongunbrokensegmentthatmustwrapwithoutlosinganycharacters" },
      { label: "Adjacent lane", value: "A fourth adjacent lane label used to test the lower label row and chart footer clearance" },
      { label: "Adjacent lane", value: "A fifth final label that must remain inside the rightmost narrow chart column" },
    ];
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const width of [240, 300, 499]) {
      const height = chartPanelHeight("constellation", rows, width);
      for (const x of [0, 48, 595.28 - width]) {
        expect(chartPanelLayoutErrors("constellation", rows, x, 760, height, width)).toEqual([]);
        const rects = chartPanelLayoutRects("constellation", rows, x, 760, height, width);
        const card = rects.find((rect) => rect.id === "card-bounds");
        expect(card).toBeDefined();
        expect(card!.x).toBeGreaterThanOrEqual(0);
        expect(card!.x + card!.width).toBeLessThanOrEqual(595.28 + 0.01);
        expect(rects.filter((rect) => rect.id.startsWith("label-constellation-value-"))).toHaveLength(5);
        const page = pdf.addPage([595.28, 841.89]);
        expect(() => drawChartPanel(page, {
          title: "Lane constellation", kind: "constellation", rows,
          shows: "Primary and adjacent lane hypotheses", cantShow: "Verified market size or audience overlap",
          width, y: 760,
        }, font, bold)).not.toThrow();
      }
    }
    expect(await pdf.save()).toBeInstanceOf(Uint8Array);
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

  it("requires every chart assertion to carry provenance matching its evidence class", () => {
    expect(chartEvidenceIntegrityErrors({
      evidenceClass: "measured", evidenceRefs: ["sonicDna.loudnessLufs"],
      rows: [{ label: "LUFS", value: -14.2 }],
    })).toEqual([]);
    expect(chartEvidenceIntegrityErrors({
      evidenceClass: "provider-recognized", evidenceRefs: ["assessment.scorecard"],
      rows: [{ label: "Recognized", value: 2 }],
    })).toContain("Chart evidence references do not match the declared evidence class.");
    expect(chartEvidenceIntegrityErrors({
      evidenceClass: "assessment-derived", rows: [{ label: "Score", value: 80 }],
    })).toContain("Chart assertion has no evidence reference.");
    expect(chartEvidenceIntegrityErrors({
      evidenceClass: "illustrative", evidenceRefs: ["reportTemplates.discoveryPathway.v1"],
      rows: [{ label: "Step", value: "Review" }],
    })).toEqual([]);
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
