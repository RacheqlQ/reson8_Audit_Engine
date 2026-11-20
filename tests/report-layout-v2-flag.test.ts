import { PDFDocument } from "@cantoo/pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePdfReport } from "../src/reports/pdf-output.js";
import { generateAuditReport } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("REPORT_LAYOUT v2 opt-in and fallback", () => {
  it("routes to the existing v1 renderer by default", async () => {
    vi.stubEnv("REPORT_LAYOUT", "");
    const expected = await generateAuditReport(fullAudioFixture as any, "full");
    const actual = await ensurePdfReport(fullAudioFixture, "full");
    expect((await PDFDocument.load(actual)).getPageCount()).toBe((await PDFDocument.load(expected)).getPageCount());
  });

  it("renders a valid PDF with gated pages omitted when v2 has only metadata/audio evidence", async () => {
    vi.stubEnv("REPORT_LAYOUT", "v2");
    const bytes = await ensurePdfReport(metadataOnlyFixture, "full");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(9);
    expect(pdf.getForm().getFields().map(field => field.getName())).toContain("ar_notes");
  });

  it("uses v2 only for the explicit v2 flag; unknown values remain v1", async () => {
    vi.stubEnv("REPORT_LAYOUT", "anything-else");
    const expected = await generateAuditReport(fullAudioFixture as any, "sample");
    const actual = await ensurePdfReport(fullAudioFixture, "sample");
    expect((await PDFDocument.load(actual)).getPageCount()).toBe((await PDFDocument.load(expected)).getPageCount());
  });

  it("logs a v2 rendering failure and falls back to the unchanged v1 renderer", async () => {
    vi.stubEnv("REPORT_LAYOUT", "v2");
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment.risks = ["Long evidence note ".repeat(1200)];
    const expected = await generateAuditReport(input, "full");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const actual = await ensurePdfReport(input, "full");
    expect(log).toHaveBeenCalledWith("[report-layout-v2] Rendering failed; falling back to v1.", expect.any(Error));
    expect((await PDFDocument.load(actual)).getPageCount()).toBe((await PDFDocument.load(expected)).getPageCount());
    log.mockRestore();
  });
});
