import { describe, expect, it } from "vitest";
import { getAuditProgressStep } from "../src/jobs/audit-progress.js";

describe("audit progress ordering", () => {
  it("keeps reconciliation visible when Sonic DNA persistence is recorded afterward", () => {
    expect(getAuditProgressStep([
      { event_type: "evidence_reconciliation", status: "reconciled" },
      { event_type: "sonic_dna", status: "completed" },
    ], "processing")).toBe(3);
  });

  it("uses the furthest completed stage rather than the newest event", () => {
    expect(getAuditProgressStep([
      { event_type: "report_generated", status: "generated" },
      { event_type: "sonic_dna", status: "completed" },
      { event_type: "ar_assessment", status: "completed" },
    ], "processing")).toBe(5);
  });

  it("reports the report stage for a completed job even if older rows lack events", () => {
    expect(getAuditProgressStep([], "completed")).toBe(5);
  });

  it("starts queued jobs at intake", () => {
    expect(getAuditProgressStep([], "queued")).toBe(0);
  });
});
