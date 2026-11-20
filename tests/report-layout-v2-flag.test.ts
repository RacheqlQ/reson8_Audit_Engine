import { PDFDocument } from "@cantoo/pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePdfReport } from "../src/reports/pdf-output.js";
import { generateAuditReport } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture, metadataOnlyFixture } from "../scripts/fixtures/sample-report-input.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("REPORT_LAYOUT v2 opt-in and fallback", () => {
  it("keeps v1 as the default and byte-for-byte returns the existing renderer output", async () => {
    vi.stubEnv("REPORT_LAYOUT", "");
    const expected = await generateAuditReport(fullAudioFixture as any, "full");
    const actual = await ensurePdfReport(fullAudioFixture, "full");
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
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
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
  });
});
