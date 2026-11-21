import { describe, expect, it } from "vitest";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { buildCoverKeyLabel, buildKeyDiagnosticLines, buildRecordingOverviewKeyLabel } from "../src/reports/v2/render.js";
import type { AuditReportInput } from "../src/reports/generate-audit-report.js";

const candidate = {
  tonic: "C", pitchClass: 0, mode: "major" as const, score: 0.52,
  bootstrapShare: 0.9, windowAgreement: 0.75, margin: 0.08,
};
const thresholds = {
  minWindows: 3, minMeanSalience: 0.12, minBootstrapShare: 0.8,
  minWindowAgreement: 0.7, minRunnerUpMargin: 0.025,
  relativePairAmbiguityMargin: 0.04, adjacentFifthsAmbiguityMargin: 0.04, bootstrapIterations: 256,
};
const input = (status: "CONFIRMED" | "PROVISIONAL" | "UNAVAILABLE"): AuditReportInput => ({
  auditId: "tonal-fixture",
  generatedAt: "2026-11-21T00:00:00.000Z",
  evidence: { masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" } },
  sonicDna: {
    key: status === "UNAVAILABLE" ? null : "C",
    mode: status === "UNAVAILABLE" ? null : "major",
    keyConfidence: 0.42,
    keySegmentAgreement: 0.75,
    provenance: "uploaded_audio_master",
  },
  tonalResolution: {
    status,
    tonic: status === "UNAVAILABLE" ? null : "C",
    mode: status === "UNAVAILABLE" ? null : "major",
    reasonCodes: status === "PROVISIONAL" ? ["LOW_WINDOW_CONSENSUS"] : status === "UNAVAILABLE" ? ["INSUFFICIENT_TONAL_EVIDENCE"] : [],
    candidates: status === "UNAVAILABLE" ? [] : [candidate],
    bootstrapShare: status === "UNAVAILABLE" ? null : 0.9,
    windowAgreement: status === "UNAVAILABLE" ? null : 0.75,
    runnerUpMargin: status === "UNAVAILABLE" ? null : 0.08,
    validWindowCount: status === "UNAVAILABLE" ? 0 : 8,
    downbeatAnchorWindowCount: status === "UNAVAILABLE" ? 0 : 6,
    cadenceWeightedWindowCount: status === "UNAVAILABLE" ? 0 : 1,
    meanSalience: status === "UNAVAILABLE" ? 0 : 0.6,
    method: "circle_of_fifths_audio_first_v1",
    thresholds,
  },
  assessment: {} as AuditReportInput["assessment"],
});

describe("tonal resolution payload-to-report mapping", () => {
  it("uses the explicit AuditReportInput resolution to report a confirmed tonic", () => {
    const reportInput = input("CONFIRMED");
    const data = adaptReportV2(reportInput);
    expect(data.tonalResolution?.status).toBe("CONFIRMED");
    expect(data.key.value).toBe("C major");
    expect(buildCoverKeyLabel(reportInput, data)).toBe("C major");
    expect(buildKeyDiagnosticLines(reportInput).join(" ")).toContain("Confirmed audio-derived tonal centre: C major.");
    expect(buildKeyDiagnosticLines(reportInput).join(" ")).toContain("Runner-up margin: 8.0% of the leading score.");
    expect(buildKeyDiagnosticLines(reportInput).join(" ")).toContain("Relative candidate scores (not probabilities): C major 0.520.");
  });

  it("keeps a provisional candidate visible without promoting it to a confirmed key", () => {
    const reportInput = input("PROVISIONAL");
    const data = adaptReportV2(reportInput);
    expect(data.tonalResolution?.status).toBe("PROVISIONAL");
    expect(data.key.value).toBeNull();
    expect(buildCoverKeyLabel(reportInput, data)).toBe("Possible: C major");
    const diagnostics = buildKeyDiagnosticLines(reportInput).join(" ");
    expect(diagnostics).toContain("Provisional audio-derived tonal centre: C major.");
    expect(diagnostics).toContain("Tonal windows do not consistently support one candidate.");
    expect(diagnostics).not.toContain("LOW_WINDOW_CONSENSUS");
    expect(data.notYetMeasured.join(" ")).not.toContain("LOW_WINDOW_CONSENSUS");
  });

  it("reports an unavailable state rather than an unexplained N/D", () => {
    const reportInput = input("UNAVAILABLE");
    const data = adaptReportV2(reportInput);
    expect(data.tonalResolution?.status).toBe("UNAVAILABLE");
    expect(buildCoverKeyLabel(reportInput, data)).toBe("Unavailable");
    expect(buildRecordingOverviewKeyLabel(data)).toBe("Unavailable");
    expect(buildKeyDiagnosticLines(reportInput).join(" ")).toContain("Tonal centre unavailable");
  });
});
