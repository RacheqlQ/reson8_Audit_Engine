import { describe, expect, it } from "vitest";
import { CIRCLE_OF_FIFTHS_PITCH_CLASSES, circleOfFifthsRootScore } from "../src/audio/key-estimation.js";

describe("circle-of-fifths tonic check", () => {
  it("uses the correct clockwise circle of fifths", () => {
    expect(CIRCLE_OF_FIFTHS_PITCH_CLASSES).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
  });

  it("supports a tonic with its neighbouring fifth and fourth in the bass", () => {
    const bassProfile = [0.6, 0, 0, 0, 0, 0.2, 0, 0.2, 0, 0, 0, 0];
    expect(circleOfFifthsRootScore(bassProfile, 0))
      .toBeGreaterThan(circleOfFifthsRootScore(bassProfile, 7));
  });

  it("does not manufacture a tonic when no bass evidence exists", () => {
    expect(circleOfFifthsRootScore(Array(12).fill(0), 0)).toBe(0);
  });
});
