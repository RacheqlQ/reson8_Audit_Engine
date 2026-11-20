import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { ensurePdfReport } from "../src/reports/pdf-output.js";
import { generateAuditReportV2 } from "../src/reports/v2/render.js";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("v2-only report generation", () => {
  it("routes every newly generated report through v2 without an environment flag", async () => {
    vi.stubEnv("REPORT_LAYOUT", "");
    const expected = await generateAuditReportV2(fullAudioFixture as any, "full");
    const actual = await ensurePdfReport(fullAudioFixture, "full");
    expect((await PDFDocument.load(actual)).getPageCount()).toBe((await PDFDocument.load(expected)).getPageCount());
  });

  it("renders a valid PDF with gated pages omitted when v2 has only metadata/audio evidence", async () => {
    const bytes = await ensurePdfReport(metadataOnlyFixture, "full");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getForm().getFields().map(field => field.getName())).toContain("ar_notes");
  });

  it("does not silently fall back to v1 if the v2 renderer fails", async () => {
    const createPdf = vi.spyOn(PDFDocument, "create").mockRejectedValueOnce(new Error("forced v2 fixture failure"));
    await expect(ensurePdfReport(fullAudioFixture, "full")).rejects.toThrow("forced v2 fixture failure");
    createPdf.mockRestore();
  });
});
