import { describe, expect, it } from "vitest";
import { getAuditProgressStepIndex } from "../src/jobs/audit-progress.js";

describe("audit progress step calculation", () => {
  it("never regresses when the Sonic DNA persistence event is newer than reconciliation", () => {
    expect(getAuditProgressStepIndex([
      "evidence_reconciliation",
      "sonic_dna",
    ], "processing")).toBe(3);
  });

  it("uses the furthest completed stage rather than the newest unknown event", () => {
    expect(getAuditProgressStepIndex([
      "evidence_reconciliation",
      "provider_fallback",
    ], "processing")).toBe(3);
  });

  it("reports the report step for completed jobs even when the final event is missing", () => {
    expect(getAuditProgressStepIndex(["sonic_dna"], "completed")).toBe(5);
  });

  it("preserves the furthest completed stage for failed jobs", () => {
    expect(getAuditProgressStepIndex([
      "evidence_reconciliation",
      "sonic_dna",
      "audit_failed",
    ], "failed")).toBe(3);
  });
});
