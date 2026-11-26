import { readFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { ensurePdfReport } from "../src/reports/pdf-output.js";
import { generateAuditReportV2 } from "../src/reports/v2/render.js";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("v2-only report generation", () => {
  it("keeps the v2 renderer independent of the legacy v1 PDF generator", async () => {
    const source = await readFile(new URL("../src/reports/v2/render.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bgenerateAuditReport\s*\(/);
    expect(source).not.toContain("PDFDocument.load(original)");
  });

  it("wires the production queue worker to the v2-only PDF entry point", async () => {
    const source = await readFile(new URL("../src/jobs/worker.ts", import.meta.url), "utf8");
    expect(source).toContain('import { ensurePdfReport } from "../reports/pdf-output.js"');
    expect(source).toContain("generateReport: ensurePdfReport");
    expect(source).not.toContain('import { generateAuditReport } from "../reports/generate-audit-report.js"');
  });

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
    expect(pdf.getForm().getFields().map(field => field.getName())).not.toContain("ar_notes");
  });

  it("does not silently fall back to v1 if the v2 renderer fails", async () => {
    const createPdf = vi.spyOn(PDFDocument, "create").mockRejectedValueOnce(new Error("forced v2 fixture failure"));
    await expect(ensurePdfReport(fullAudioFixture, "full")).rejects.toThrow("forced v2 fixture failure");
    createPdf.mockRestore();
  });
});
