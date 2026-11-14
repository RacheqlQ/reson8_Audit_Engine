import { describe, expect, it } from "vitest";
import { metadataFieldStatus, normalizeReportText, planAuditReportPages } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("professional report text and metadata coverage", () => {
  it("normalizes unsupported punctuation to printable PDF-safe characters", () => {
    expect(normalizeReportText("189–second • high‑energy “mix” — don’t…")).toBe("189-second - high-energy \"mix\" - don't...");
    expect(normalizeReportText("Bend Et �")).toBe("Bend Et ?");
  });

  it("keeps metric precision concise without changing integer values", () => {
    const pages = planAuditReportPages(fullAudioFixture as any, "full");
    const text = pages.flatMap((page) => page.text).join(" ");
    expect(text).not.toMatch(/\d+\.\d{4,}/);
  });

  it("includes all key identity fields and explicit unavailable states in full reports", () => {
    const input = {
      ...fullAudioFixture,
      evidence: { ...fullAudioFixture.evidence, isrc: "NGABC2600001", upc: null, genre: null, genres: [], externalIds: {}, sourceProviders: ["spotify", "audd"], reconciliation: { status: "conflict", reconciledFields: [], conflicts: [{ field: "isrc", values: ["NGABC2600001", "NGABC2600002"] }] } },
    };
    expect(metadataFieldStatus(input.evidence as Record<string, unknown>, "isrc")).toBe("Conflicting source values");
    const text = planAuditReportPages(input as any, "full").flatMap((page) => [page.title, ...page.text]).join(" ");
    for (const field of ["Artist:", "Track:", "Album:", "Genre:", "ISRC:", "UPC:", "Release date:", "Label:", "External identifiers:", "Sources checked:"]) {
      expect(text).toContain(field);
    }
    expect(text).toContain("Unavailable — no source result");
    expect(text).toContain("ISRC: Conflicting source values");
    expect(text).toContain("not inferred or fabricated");
  });
});
