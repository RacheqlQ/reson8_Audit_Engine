import { describe, expect, it } from "vitest";
import { getAuditProgressStep } from "../src/jobs/audit-progress.js";

describe("audit progress", () => {
  it("never regresses when a later Sonic DNA persistence event follows reconciliation", () => {
    const events = [
      { event_type: "sonic_dna" },
      { event_type: "evidence_reconciliation" },
      { event_type: "sonic_dna" },
    ];

    expect(getAuditProgressStep(events, "processing")).toBe(3);
  });

  it("reports the furthest completed stage regardless of event ordering", () => {
    expect(getAuditProgressStep([
      { event_type: "ar_assessment" },
      { event_type: "sonic_dna" },
      { event_type: "report_generated" },
    ], "processing")).toBe(5);
  });

  it("reports completion even when no progress event is present", () => {
    expect(getAuditProgressStep([], "completed")).toBe(5);
  });
});
