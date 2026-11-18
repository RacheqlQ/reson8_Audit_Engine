import { describe, expect, it } from "vitest";
import { getAuditProgress, getAuditProgressStep } from "../src/jobs/audit-progress.js";

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

  it("computes stage and collective percentages from persisted evidence events", () => {
    const progress = getAuditProgress([
      { event_type: "recognition" },
      { event_type: "sonic_dna" },
      { event_type: "evidence_reconciliation" },
      { event_type: "ar_assessment" },
      { event_type: "report_generated" },
    ], "processing", "combined");

    expect(progress.stages.map(({ id, percent }) => [id, percent])).toEqual([
      ["intake", 100], ["recognition", 100], ["sonic_dna", 100],
      ["reconciliation", 100], ["assessment", 100], ["report", 50], ["finalization", 0],
    ]);
    expect(progress.overallPercent).toBe(78.6);
    expect(progress.stages[5].status).toBe("in_progress");
    expect(progress.stages[6].status).toBe("pending");
  });

  it("marks Sonic DNA not applicable for DSP-only audits without inflating the stage count", () => {
    const progress = getAuditProgress([
      { event_type: "recognition" },
      { event_type: "evidence_reconciliation" },
      { event_type: "ar_assessment" },
      { event_type: "report_generated" },
      { event_type: "report_generated" },
      { event_type: "audit_completed" },
    ], "completed", "dsp_link");

    expect(progress.stages[2]).toMatchObject({ percent: 100, status: "not_applicable" });
    expect(progress.overallPercent).toBe(100);
    expect(progress.completedStages).toBe(6);
    expect(progress.notApplicableStages).toBe(1);
  });

  it("marks the first incomplete stage failed when the audit has a terminal failure", () => {
    const progress = getAuditProgress([
      { event_type: "recognition" },
      { event_type: "sonic_dna" },
      { event_type: "audit_failed" },
    ], "failed", "master");

    expect(progress.stages[3]).toMatchObject({ percent: 0, status: "failed" });
    expect(progress.overallPercent).toBe(42.9);
  });
});

describe("report progress accounting", () => {
  it("counts distinct report tiers rather than duplicate versions of one tier", () => {
    const progress = getAuditProgress([
      { event_type: "recognition" },
      { event_type: "sonic_dna" },
      { event_type: "evidence_reconciliation" },
      { event_type: "ar_assessment" },
      { event_type: "report_generated", payload: { tier: "sample" } },
      { event_type: "report_generated", payload: { tier: "sample" } },
    ], "processing", "master");
    expect(progress.stages.find((stage) => stage.id === "report")).toMatchObject({ percent: 50, status: "in_progress" });
  });
});
