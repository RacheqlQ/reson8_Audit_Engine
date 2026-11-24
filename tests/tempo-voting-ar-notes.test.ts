import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { buildArNotesDecisionContextFull } from "../src/reports/generate-audit-report.js";
import { generateAuditReportV2 } from "../src/reports/v2/render.js";
import { adaptReportV2 } from "../src/reports/v2/adapters.js";
import { buildTempoDiagnosticLines } from "../src/reports/v2/render.js";
import { isReliableTempo } from "../src/reports/evidence-guardrails.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("A&R Notes report page", () => {
  it("renders all requested sign-off fields and a notes workspace covering at least 35% of A4 height", async () => {
    const input = structuredClone(fullAudioFixture) as any;
    const pdf = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    const fields = pdf.getForm().getFields();
    const names = fields.map(field => field.getName());
    expect(names).toHaveLength(6);
    expect(names).toEqual(expect.arrayContaining([
      "ar_notes", "ar_owner", "ar_followup_date",
      "ar_decision_hold", "ar_decision_reaudit", "ar_decision_proceed",
    ]));
    const notes = pdf.getForm().getTextField("ar_notes");
    const rectangle = notes.acroField.getWidgets()[0]!.getRectangle();
    expect(rectangle.height).toBeGreaterThanOrEqual(841.89 * 0.35);
    expect(pdf.getPageCount()).toBe(7);
  });

  it("never promotes a stale BPM when the explicit tempo verdict is only a candidate", () => {
    expect(isReliableTempo({
      bpm: 92,
      tempoConfidence: 0.9,
      rhythmFeatures: { status: "measured", tempoVerdict: { confirmation_status: "CANDIDATE" } },
    })).toBe(false);
  });

  it("carries an unconfirmed tempo candidate and supported octave alternatives into report guidance", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      bpm: null,
      tempoCandidateBpm: 92,
      tempoConfidence: 0.32,
      rhythmFeatures: {
        tempoVerdict: {
          primary_candidate_bpm: 92,
          octave_alternatives: [46, 184],
          confirmation_status: "CANDIDATE",
          explanation: "Half-time and double-time interpretations remain materially supported.",
        },
      },
    };
    const diagnostics = buildTempoDiagnosticLines(input).join(" ");
    expect(diagnostics).toContain("Tempo candidate: 92 BPM; not confirmed.");
    expect(diagnostics).toContain("46 / 184 BPM");
    expect(diagnostics).toContain("Half-time and double-time interpretations remain materially supported.");
    expect(adaptReportV2(input).notYetMeasured.join(" ")).toContain("92 BPM");
    expect(adaptReportV2(input).notYetMeasured.join(" ")).toContain("46 / 184 BPM");
  });

  it("keeps internal analysis status notices out of the A&R Notes decision context", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment = {
      ...input.assessment,
      limitations: [
        "Vocal analysis: Not performed - Vocal analysis is temporarily disabled to keep the audit worker within its memory limit.",
        "Vocal presence/absence is unknown and is not inferred.",
        "No vocal conclusion is available because the separation model did not complete.",
        "Learned audio model: disabled.",
        "Detection model status: disabled.",
      ],
    };
    const context = buildArNotesDecisionContextFull(input);
    expect(context.summary).not.toMatch(/Vocal analysis: Not performed|Vocal presence\/absence is unknown|No vocal conclusion is available|Learned audio model: disabled|Detection model status: disabled/i);
  });

  it("does not publish a zero-prominence tempo candidate or derived octave pulse", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      ...input.sonicDna,
      bpm: null,
      tempoCandidateBpm: 128,
      tempoConfidence: 0,
      alternateTempo: 64,
      rhythmFeatures: {
        tempoVerdict: {
          primary_candidate_bpm: 128,
          octave_alternatives: [64],
          confirmation_status: "CANDIDATE",
          prominence_score: 0,
          explanation: "Transient prominence is unavailable.",
        },
        candidateScores: [{ bpm: 128, score: 0 }],
        candidateBpms: [128],
        alternateTempo: 64,
      },
    };
    const diagnostics = buildTempoDiagnosticLines(input).join(" ");
    expect(diagnostics).not.toContain("128 BPM");
    expect(diagnostics).not.toContain("64 BPM");
    expect(diagnostics).not.toContain("Possible tempo readings");
    expect(diagnostics).not.toContain("Alternative pulse reading");
  });

  it("keeps complete A&R decision sentences and exactly three review prompts", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.assessment = { ...input.assessment, executiveSummary: "A complete decision summary requiring human listening, source verification, identity reconciliation, rights review and release planning. ".repeat(3), evidenceGaps: ["Confirm the final master and recording identifier.", "Verify the rights and delivery records before external pitching."] };
    const context = buildArNotesDecisionContextFull(input);
    expect(context.prompts).toHaveLength(3);
    expect(context.summary).not.toContain("...");
    expect(context.summary.length).toBeGreaterThan(180);
    const dimensions = adaptReportV2(input).decisionDimensions;
    expect(dimensions.map(item => item.name)).toEqual(["Audio", "Identity", "Market", "Release readiness"]);
  });
});
