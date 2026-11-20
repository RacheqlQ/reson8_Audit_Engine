import { describe, expect, it } from "vitest";
import { bootstrapCategoricalConsensus } from "../src/audio/ensemble-consensus.js";

describe("bootstrap categorical consensus", () => {
  it("returns stable majority diagnostics for repeated window labels", () => {
    const result = bootstrapCategoricalConsensus(
      ["C:major", "C:major", "C:major", "G:major", "C:major", "G:major"],
      { iterations: 500, seed: 42 },
    );

    expect(result).toMatchObject({
      winner: "C:major",
      windowCount: 6,
      observedAgreement: 4 / 6,
      iterations: 500,
      method: "deterministic_window_bootstrap",
    });
    expect(result.lowerAgreementBound).toBeLessThanOrEqual(result.observedAgreement);
    expect(result.upperAgreementBound).toBeGreaterThanOrEqual(result.observedAgreement);
  });

  it("is deterministic for the same labels and seed", () => {
    const labels = ["120", "120", "60", "120", "121"];
    expect(bootstrapCategoricalConsensus(labels, { seed: 7 }))
      .toEqual(bootstrapCategoricalConsensus(labels, { seed: 7 }));
  });

  it("returns unavailable diagnostics when no windows contain usable evidence", () => {
    expect(bootstrapCategoricalConsensus([])).toMatchObject({
      winner: null,
      windowCount: 0,
      observedAgreement: null,
      lowerAgreementBound: null,
      upperAgreementBound: null,
    });
  });

  it("does not manufacture agreement from a tied set of window labels", () => {
    const result = bootstrapCategoricalConsensus(["A", "B", "A", "B"], { seed: 9 });
    expect(result.winner).toBeNull();
    expect(result.observedAgreement).toBeNull();
  });
});
