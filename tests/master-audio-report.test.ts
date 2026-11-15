import { describe, expect, it } from "vitest";
import { planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("uploaded master provenance in reports", () => {
  it("reports an observed master submission even when Sonic DNA measurements are absent", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = null;
    input.evidence = {
      ...input.evidence,
      fixture: false,
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
  it("reports measured integrated loudness and explicitly discloses unperformed vocal analysis", () => {
    const input = structuredClone(fullAudioFixture) as AuditReportInput;
    input.sonicDna = {
      ...input.sonicDna,
      loudnessLufs: -11.32,
      dynamicRangeDb: 13.11,
      vocalFeatures: {
        status: "not_analyzed",
        reason: "No vocal separation or vocal-activity model is configured.",
      },
    };
    const report = planAuditReportPages(input, "full")
      .flatMap((section) => [section.title, ...section.text])
      .join(" ");
    expect(report).toContain("Integrated loudness: -11.32 LUFS");
    expect(report).toContain("Dynamic range: 13.11 dB");
    expect(report).toContain("Vocal analysis: Not performed");
    expect(report).toMatch(/vocal presence\\/absence is unknown/i);
  });

});
