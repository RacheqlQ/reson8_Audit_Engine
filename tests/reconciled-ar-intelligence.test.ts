import { describe, expect, it } from "vitest";
import { buildReconciledArIntelligence } from "../src/reports/v2/reconciled-ar-intelligence.js";
import { buildMandatoryArAnswerLines, buildSwotSmartLines } from "../src/reports/v2/render.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

describe("zero-cost reconciled A&R intelligence", () => {
  it("returns all eight mandatory A&R answers with evidence boundaries", () => {
    const input = structuredClone(fullAudioFixture) as any;
    const result = buildReconciledArIntelligence(input);
    expect(result.answers).toHaveLength(8);
    expect(result.answers.every(item => item.question.trim() && item.answer.trim())).toBe(true);
    expect(result.answers.find(item => /release status/i.test(item.question))?.answer).toMatch(/DETERMINED|UNVERIFIED/);
    expect(result.answers.find(item => /market|territor/i.test(item.question))?.answer).toMatch(/PROPOSED|VERIFIED/);
  });

  it("does not promote low-confidence tempo or key fields into confirmed A&R findings", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      bpm: 96, tempoConfidence: 0.2, key: "A", mode: "minor",
      keyConfidence: 0.2, keySegmentAgreement: 0.2
    };
    const answer = buildReconciledArIntelligence(input).answers[0].answer;
    expect(answer).toContain("Tempo is not confirmed");
    expect(answer).toContain("Key is not confirmed");
    expect(answer).not.toContain("96 BPM");
    expect(answer).not.toContain("A minor");
  });

  it("does not turn missing acoustic descriptors into zero-valued vocal or cadence claims", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = { acousticFeatureProfile: { status: "insufficient_evidence", descriptors: {} } };
    const result = buildReconciledArIntelligence(input);
    expect(result.vocalCadence.provenance).toBe("HEURISTIC_SIGNAL_DERIVED");
    expect(result.vocalCadence.findings.join(" ")).toMatch(/not determined|insufficient|not available/i);
    expect(result.vocalCadence.findings.join(" ")).not.toMatch(/vocal present|lead vocal|singer/i);
  });

  it("uses measured descriptors as bounded signal proxies without claiming human vocal detection", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.sonicDna = {
      acousticFeatureProfile: {
        status: "measured",
        descriptors: {
          midBandEnergyRatio: { median: 0.42, unit: "ratio" },
          highBandEnergyRatio: { median: 0.18, unit: "ratio" },
          spectralFlux: { median: 0.12, unit: "ratio" },
          zeroCrossingRate: { median: 0.09, unit: "ratio" },
          spectralCentroidHz: { median: 2800, unit: "Hz" },
          crestFactorDb: { median: 9, unit: "dB" }
        }
      }
    };
    const result = buildReconciledArIntelligence(input);
    const joined = result.vocalCadence.findings.join(" ");
    expect(joined).toMatch(/mid-band|cadence|transient|spectral/i);
    expect(joined).toMatch(/proxy|heuristic|not proof/i);
    expect(joined).not.toMatch(/vocal present|lead vocal detected|singer identified/i);
  });

  it("provides complete SWOT and four fully specified SMART windows", () => {
    const result = buildReconciledArIntelligence(structuredClone(fullAudioFixture) as any);
    expect(result.swot.map(item => item.category)).toEqual(["Strengths", "Weaknesses", "Opportunities", "Threats"]);
    expect(result.swot.find(item => item.category === "Opportunities")?.items.every(item => item.startsWith("[PROPOSED]"))).toBe(true);
    expect(result.smartActions.map(item => item.window)).toEqual(["Days 1–14", "Days 15–30", "Days 31–60", "Days 61–90"]);
    for (const action of result.smartActions) {
      for (const field of ["specific", "measurable", "achievable", "relevant", "timeBound"] as const) {
        expect(action[field].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("places all eight A&R answers and SWOT/SMART content into the existing report sections", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.fieldProvenance = { releaseDate: "apple_music" };
    const answers = buildMandatoryArAnswerLines(input);
    const actions = buildSwotSmartLines(input);
    expect(answers).toHaveLength(8);
    expect(answers.map(line => line.split(" ")[0])).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]);
    expect(actions.join(" ")).toContain("STRENGTHS:");
    expect(actions.join(" ")).toContain("WEAKNESSES:");
    expect(actions.join(" ")).toContain("OPPORTUNITIES:");
    expect(actions.join(" ")).toContain("THREATS:");
    for (const label of ["Specific:", "Measurable:", "Achievable:", "Relevant:", "Time-bound:"]) {
      expect(actions.join(" ")).toContain(label);
    }
  });

  it("rejects impossible calendar dates and does not infer release dates from unverified values", () => {
    const input = structuredClone(fullAudioFixture) as any;
    input.evidence.releaseDate = "2025-02-30";
    input.evidence.fieldProvenance = {};
    const result = buildReconciledArIntelligence(input);
    expect(result.releaseDate.verdict).toBe("UNVERIFIED");
    expect(result.releaseDate.date).toBe("Date not reconciled");
  });
});
