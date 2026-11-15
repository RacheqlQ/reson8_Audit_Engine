import { describe, expect, it } from "vitest";
import { planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("uploaded master provenance in reports", () => {
  it("reports an observed master submission even when Sonic DNA measurements are absent", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = null;
    input.evidence = {
      ...input.evidence,
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
      sourceCombination: "master_and_dsp",
    };

    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");

    expect(report).toContain("Uploaded master submitted; master-derived measurements are reported separately.");
    expect(report).toContain("Master audio submitted; master-derived Sonic DNA measurements unavailable.");
    expect(report).not.toContain("Not measured: no master audio supplied.");
  });
});
