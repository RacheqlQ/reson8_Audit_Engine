import { describe, expect, it } from "vitest";
import { voteTempoCandidates } from "../src/audio/tempo-voting.js";

describe("deterministic tempo voting", () => {
  it("confirms a high-consensus, high-prominence tempo", () => {
    const result = voteTempoCandidates({ windows: [
      { bpm: 92.1, prominence: 0.91, beatStrength: 0.9, durationSeconds: 8 },
      { bpm: 91.8, prominence: 0.88, beatStrength: 0.86, durationSeconds: 8 },
      { bpm: 92.2, prominence: 0.93, beatStrength: 0.92, durationSeconds: 8 },
      { bpm: 92, prominence: 0.9, beatStrength: 0.9, durationSeconds: 8 },
    ] });
    expect(result.confirmation_status).toBe("CONFIRMED");
    expect(result.primary_candidate_bpm).toBeCloseTo(92, 0);
    expect(result.vote_share).toBeGreaterThanOrEqual(0.65);
    expect(result.window_agreement).toBeGreaterThanOrEqual(0.65);
  });

  it("groups half, nominal and double time while preserving alternatives and ambiguity", () => {
    const result = voteTempoCandidates({ windows: [
      { bpm: 46, prominence: 0.9, durationSeconds: 8 },
      { bpm: 92, prominence: 0.9, durationSeconds: 8, candidates: [
        { bpm: 92, prominence: 0.9 }, { bpm: 92.4, prominence: 0.9 },
      ] },
      { bpm: 184, prominence: 0.9, durationSeconds: 8 },
    ] });
    expect(result.primary_candidate_bpm).toBe(92);
    expect(result.octave_alternatives).toEqual(expect.arrayContaining([46, 184]));
    expect(result.confirmation_status).not.toBe("CONFIRMED");
    expect(result.reason_codes).toContain("OCTAVE_METRICAL_AMBIGUITY");
    expect(result.raw_candidates).toHaveLength(3);
  });

  it("withholds confirmation for weak prominence and invalid votes", () => {
    const result = voteTempoCandidates({ windows: [
      { bpm: 92, prominence: 0.12, durationSeconds: 8 },
      { bpm: 92.2, prominence: 0.1, durationSeconds: 8 },
      { bpm: Number.NaN, prominence: 1, durationSeconds: 8 },
      { bpm: 0, prominence: 1, durationSeconds: 8 },
    ] });
    expect(result.confirmation_status).not.toBe("CONFIRMED");
    expect(result.reason_codes).toContain("LOW_TRANSIENT_PROMINENCE");
    expect(result.primary_candidate_bpm).toBe(92);
  });

  it("confirms a single high-quality window only when its vote has full share and no ambiguity", () => {
    const result = voteTempoCandidates({ windows: [
      { bpm: 92, prominence: 0.95, beatStrength: 0.95, durationSeconds: 8 },
    ] });
    expect(result.confirmation_status).toBe("CONFIRMED");
    expect(result.vote_share).toBe(1);
    expect(result.runner_up_margin).toBe(1);
  });

  it("reports tied metrical candidates as provisional rather than inventing certainty", () => {
    const result = voteTempoCandidates({ windows: [
      { bpm: 90, prominence: 0.9, durationSeconds: 8 },
      { bpm: 100, prominence: 0.9, durationSeconds: 8 },
    ] });
    expect(result.confirmation_status).not.toBe("CONFIRMED");
    expect(result.reason_codes.length).toBeGreaterThan(0);
  });
});
