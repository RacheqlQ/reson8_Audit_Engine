import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { sanitizeAssessmentForEvidence } from "../src/reports/evidence-guardrails.js";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { buildReconciledArIntelligence } from "../src/reports/v2/reconciled-ar-intelligence.js";
import { buildConfirmedAudioEvidenceLines, buildCoverKeyLabel, buildCoverTempoLabel, buildKeyDiagnosticLines, buildPositioningLines, buildProposedArrangement, buildTempoDiagnosticLines, generateAuditReportV2, metricBlock } from "../src/reports/v2/render.js";
import { sanitizePublicReportLine } from "../src/reports/v2/public-language.js";

describe("voting-backed confirmation and report consistency", () => {
  it("surfaces voting-confirmed tempo and resolver-confirmed key across cover, diagnostics and scorecard evidence", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      bpm: 120,
      tempoConfidence: 0.91,
      rhythmFeatures: {
        beatGridStatus: "tentative",
        beatTimesSeconds: [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
        tempoVerdict: {
          primary_candidate_bpm: 120,
          confirmation_status: "CONFIRMED",
          vote_share: .86,
          window_agreement: .9,
          runner_up_margin: .31,
          prominence_score: .88,
          explanation: "Weighted candidate consensus passed."
        }
      },
      key: "A",
      mode: "minor",
      tonalResolution: input.tonalResolution
    };
    const data = adaptReportV2(input);
    expect(data.tempo.value).toBe(120);
    expect(data.key.value).toBe("A minor");
    expect(buildCoverTempoLabel(data, input)).toBe("120 BPM");
    expect(buildCoverKeyLabel(input, data)).toBe("A minor");
    expect(metricBlock(data, input).find(item => item.label === "TEMPO")?.confidence).toBe("CONFIRMED");
    expect(metricBlock(data, input).find(item => item.label === "SONG KEY")?.confidence).toBe("CONFIRMED");
    expect(buildConfirmedAudioEvidenceLines(data).join(" ")).toMatch(/TEMPO INFERENCE · CONFIRMED/);
    expect(buildConfirmedAudioEvidenceLines(data).join(" ")).toMatch(/TONAL INFERENCE · CONFIRMED/);
    expect(buildTempoDiagnosticLines(input).join(" ")).toContain("Confirmed tempo: 120 BPM");
    expect(buildKeyDiagnosticLines(input).join(" ")).toMatch(/confirmed.*A minor|A minor.*confirmed/i);

    const assessment = sanitizeAssessmentForEvidence(input.assessment, input.sonicDna, input.evidence);
    expect(assessment.scorecard.rhythmicConsistency.score).not.toBeNull();
    expect(assessment.scorecard.rhythmicConsistency.rationale).toContain("Voting-confirmed tempo anchors");
    expect(assessment.scorecard.tonalConsensus.score).toBeGreaterThan(0);
    expect(assessment.scorecard.tonalConsensus.rationale).toContain("CONFIRMED tonal centre");
    expect(assessment.scorecard.tonalConsensus.rationale).toContain("not artistic quality");
  });

  it("removes the bracketed genre placeholder from positioning language", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.genre = "Afro-R&B";
    input.evidence.genreSource = null;
    const lines = buildPositioningLines(input).join(" ");
    expect(lines).toContain("Genre direction: Afro-R&B · PROPOSED");
    expect(lines).not.toContain("[working direction · platform source not supplied]");
    expect(sanitizePublicReportLine("Genre direction: Afro-R&B [working direction · platform source not supplied]"))
      .not.toContain("[working direction · platform source not supplied]");
  });

  it("continues post-release marketing as PROPOSED while preserving a determined release date", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.generatedAt = "2026-11-24T12:00:00.000Z";
    input.evidence.releaseDate = "2026-10-01";
    input.evidence.fieldProvenance = { ...(input.evidence.fieldProvenance ?? {}), releaseDate: "apple_music" };
    const result = buildReconciledArIntelligence(input);
    expect(result.releaseDate.verdict).toBe("DETERMINED");
    expect(result.releaseDate.context).toBe("POST-RELEASE");
    expect(result.marketVerdict).toBe("PROPOSED");
    expect(result.smartActions[2].specific).toMatch(/hook moment|short-form|re-pitch/i);
    expect(result.smartActions[2].measurable).toContain("3 distinct hook-led cutdowns");
    expect(result.smartActions[3].specific).toMatch(/catalyst drop/i);
    expect(result.smartActions[3].measurable).toContain("1 approved catalyst activation");
  });

  it("builds a lane-aligned proposed arrangement and renders it without changing either report tier page count", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.genre = "Afrobeats";
    input.sonicDna.durationSeconds = 180;
    input.sonicDna.tonalResolution = null;
    input.sonicDna.energyOverTime = [{ timeSeconds: 0, value: -20 }, { timeSeconds: 180, value: -8 }];
    input.vocalAndSectionPageData = { vocalActivityIntervals: [{ startSeconds: 0, endSeconds: 20 }], vocalPresencePct: 11 };
    const proposal = buildProposedArrangement(input);
    expect(proposal.summary).toContain("PROPOSED");
    expect(proposal.summary).toContain("Afrobeats");
    expect(proposal.summary).toContain("A minor · CONFIRMED");
    expect(proposal.summary).toContain("relative energy envelope");
    expect(proposal.summary).toContain("1 signal-derived vocal activity interval");
    expect(proposal.segments[0].intensity).not.toBe(proposal.segments.at(-1)?.intensity);
    expect(proposal.segments[0].startPct).toBe(0);
    expect(proposal.segments.at(-1)?.endPct).toBeCloseTo(100, 5);
    expect(proposal.segments.map(segment => segment.label).join(" ")).toMatch(/hook|chorus/i);
    expect(Math.max(...proposal.segments.map(segment => segment.intensity))).toBe(1);

    const sample = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    const full = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(sample.getPageCount()).toBe(8);
    expect(full.getPageCount()).toBe(13);
  });
});
