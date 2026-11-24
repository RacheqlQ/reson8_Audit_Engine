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
      errorMessage: "storage rejected [path]?token=[redacted]",
      timedOut: false,
      errorCode: "UNCLASSIFIED_STAGE_ERROR",
      stackFingerprint: expect.stringMatching(/^stk-[a-f0-9]{8}$/),
    });
    expect(JSON.stringify(diagnostic)).not.toContain("owner-private");
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    expect(JSON.stringify(diagnostic)).not.toContain("report.pdf");
    expect(diagnostic.errorMessage).toContain("storage rejected");
  });

  it("retains a bounded timeout message for internal diagnosis", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "full_pdf_generation",
      new Error("AUDIT_STAGE_TIMEOUT:full_pdf_generation"),
    );

    expect(diagnostic).toEqual({
      stage: "full_pdf_generation",
      failureCode: "timeout",
      errorName: "Error",
      errorMessage: "AUDIT_STAGE_TIMEOUT:full_pdf_generation",
      timedOut: true,
      errorCode: "UNCLASSIFIED_STAGE_ERROR",
      stackFingerprint: expect.stringMatching(/^stk-[a-f0-9]{8}$/),
    });
  });

  it("redacts URLs, emails, identifiers, and truncates exception messages", () => {
    const diagnostic = buildAuditStageFailureDiagnostic("sample_pdf_generation", new Error("Failed https://private.example/report?token=secret for owner@example.com id 12345678-1234-1234-1234-123456789012"));
    expect(diagnostic.errorMessage).not.toContain("private.example");
    expect(diagnostic.errorMessage).not.toContain("secret");
    expect(diagnostic.errorMessage).not.toContain("owner@example.com");
    expect(diagnostic.errorMessage).not.toContain("12345678-1234");
    expect(diagnostic.errorMessage.length).toBeLessThanOrEqual(240);
  });

  it("classifies known full-report layout failures without exposing report text", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "full_pdf_generation",
      new Error("Full report content cannot fit the approved 12-page V2 allocation without clipping or omission."),
    );
    expect(diagnostic.errorCode).toBe("PDF_FULL_REPORT_ALLOCATION_UNFIT");
    expect(JSON.stringify(diagnostic)).not.toContain("approved 12-page");
  });

  it("classifies unsupported PDF font encoding failures without exposing the offending text", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "full_pdf_generation",
      new Error("WinAnsi cannot encode 🎵"),
    );
    expect(diagnostic.errorCode).toBe("PDF_FONT_ENCODING_ERROR");
    expect(JSON.stringify(diagnostic)).not.toContain("🎵");
  });

  it("classifies provider HTTP 402 as a billing-related provider failure without exposing response text", () => {
    const diagnostic = buildAuditStageFailureDiagnostic(
      "ai_assessment",
      new Error("Ollama evidence-score assessment failed with HTTP 402: account billing details are private"),
    );
    expect(diagnostic).toMatchObject({
      stage: "ai_assessment",
      failureCode: "provider_unavailable",
      errorCode: "AI_PROVIDER_BILLING_REQUIRED",
      timedOut: false,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("billing details");
  });
});

  