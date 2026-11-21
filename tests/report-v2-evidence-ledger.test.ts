import { describe, expect, it } from "vitest";
import { buildEvidenceLedgerSummary } from "../src/reports/v2/render.js";

describe("v2 evidence ledger summary", () => {
  it("uses the same evidence-label counts as the evidence-layer chart", () => {
    const labels = [
      { label: "OBSERVED" }, { label: "OBSERVED" }, { label: "OBSERVED" },
      { label: "RECOGNIZED" },
      { label: "RECONCILED" }, { label: "RECONCILED" },
      { label: "INFERRED" },
      { label: "INDUSTRY PRACTICE" },
    ];

    expect(buildEvidenceLedgerSummary(labels)).toBe(
      "Measured: 3 · Music platform records: 1 · Verified matches: 2 · Suggested directions: 1",
    );
  });

  it("reports zero counts when no evidence labels are supplied", () => {
    expect(buildEvidenceLedgerSummary([])).toBe(
      "Measured: 0 · Music platform records: 0 · Verified matches: 0 · Suggested directions: 0",
    );
  });
});
