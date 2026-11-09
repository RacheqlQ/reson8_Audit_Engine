import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { countEvidenceLayers, drawChartPanel } from "../src/reports/charts.js";

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
      title: "Null data", kind: "spectrum",
      rows: [{ label: "Energy", value: null }, { label: "Tempo", value: undefined }],
      shows: "supplied values", cantShow: "unknown values",
    }, font, bold)).not.toThrow();

    expect(await pdf.save()).toBeInstanceOf(Uint8Array);
  });

  it("counts evidence layers exactly from the supplied labels", () => {
    expect(countEvidenceLayers([
      { label: "OBSERVED" },
      { label: "RECOGNIZED" },
      { label: "INFERRED" },
      { label: "INFERRED" },
    ])).toEqual({ OBSERVED: 1, RECOGNIZED: 1, RECONCILED: 0, INFERRED: 2 });
  });
});
