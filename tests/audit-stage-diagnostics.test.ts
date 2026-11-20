import { describe, expect, it } from "vitest";
import { buildAuditStageFailureDiagnostic } from "../src/jobs/process-audit-job.js";

describe("audit stage failure diagnostics", () => {
  it("identifies the failing stage and safe error category without exposing exception text", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "full_pdf_persistence",
      new Error("storage rejected owner-private/path/report.pdf?token=secret"),
    );

    expect(diagnostic).toEqual({
      stage: "full_pdf_persistence",
      failureCode: "processing_error",
      errorName: "Error",
      timedOut: false,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("owner-private");
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });

  it("marks stage timeouts without including the timeout message", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "full_pdf_generation",
      new Error("AUDIT_STAGE_TIMEOUT:full_pdf_generation"),
    );

    expect(diagnostic).toEqual({
      stage: "full_pdf_generation",
      failureCode: "timeout",
      errorName: "Error",
      timedOut: true,
    });
  });
});
