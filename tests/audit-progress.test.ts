import { describe, expect, it } from "vitest";
import { currentAuditStepIndex } from "../src/jobs/audit-progress.js";

describe("currentAuditStepIndex", () => {
  it("does not regress when the Sonic DNA event is persisted after reconciliation", () => {
    expect(currentAuditStepIndex([
      { event_type: "recognition" },
      { event_type: "evidence_reconciliation" },
      { event_type: "sonic_dna" },
    ])).toBe(3);
  });

  it("keeps assessment progress when section-cache events arrive", () => {
    expect(currentAuditStepIndex([
      { event_type: "evidence_reconciliation" },
      { event_type: "ar_assessment_started" },
      { event_type: "groq_section_completed" },
    ])).toBe(4);
  });

  it("advances to report generation and ignores unrelated events", () => {
    expect(currentAuditStepIndex([
      { event_type: "evidence_reconciliation" },
      { event_type: "groq_section_completed" },
      { event_type: "report_generation_started" },
      { event_type: "catalog_links_submitted" },
    ])).toBe(5);
  });
});
