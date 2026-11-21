import { describe, expect, it } from "vitest";
import {
  fifthsDistance,
  relativeMinorOfMajor,
  relativeMajorOfMinor,
  parallelMajor,
  parallelMinor,
  resolveTonalCentre,
  type TonalWindow,
} from "../src/audio/tonal-resolution.js";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const majorScale = (root: number, tonicWeight = 5): number[] => {
  const values = Array(12).fill(0);
  for (const interval of [0, 2, 4, 5, 7, 9, 11]) values[(root + interval) % 12] = interval === 0 ? tonicWeight : 1.5;
  return values;
};
const windows = (root: number, mode: "major" | "minor", count = 8): TonalWindow[] => {
  const intervals = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return Array.from({ length: count }, (_, index) => {
    const chroma = Array(12).fill(0.05);
    for (const interval of intervals) chroma[(root + interval) % 12] = interval === 0 ? 5 : 1.5;
    const bassChroma = Array(12).fill(0.01);
    bassChroma[root] = 8;
    return { startSeconds: index * 6, endSeconds: index * 6 + 12, chroma, bassChroma, salience: 0.9, energy: 0.2, downbeatRoot: root, cadenceWeight: index === count - 1 ? 1 : 0 };
  });
};

describe("deterministic tonal resolution geometry", () => {
  it("measures shortest Circle of Fifths distance", () => {
    expect(fifthsDistance("C", "G")).toBe(1);
    expect(fifthsDistance("C", "A")).toBe(3);
    expect(fifthsDistance("C", "F#")).toBe(6);
    expect(fifthsDistance("C#", "Db")).toBe(0);
  });

  it("maps relative and parallel keys", () => {
    expect(relativeMinorOfMajor("C")).toBe("A");
    expect(relativeMajorOfMinor("A")).toBe("C");
    expect(parallelMajor("A")).toBe("A");
    expect(parallelMinor("C")).toBe("C");
  });

  it("confirms a stable audio-derived C major tonic with bass anchors", () => {
    const result = resolveTonalCentre(windows(0, "major"));
    expect(result.status).toBe("CONFIRMED");
    expect(result.tonic).toBe("C");
    expect(result.mode).toBe("major");
    expect(result.bootstrapShare).toBeGreaterThanOrEqual(0.8);
    expect(result.windowAgreement).toBeGreaterThanOrEqual(0.7);
  });

  it("retains a relative major/minor ambiguity as provisional rather than inventing a winner", () => {
    const ambiguous = windows(0, "major").map((window) => ({
      ...window,
      chroma: majorScale(0, 2).map((value, index) => Math.max(value, majorScale(9, 2)[index])),
      bassChroma: Array(12).fill(1),
      downbeatRoot: null,
      cadenceWeight: 0,
    }));
    const result = resolveTonalCentre(ambiguous);
    expect(result.status).toBe("PROVISIONAL");
    expect(result.reasonCodes).toContain("RELATIVE_MAJOR_MINOR_AMBIGUITY");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("returns UNAVAILABLE for low-salience windows", () => {
    const result = resolveTonalCentre(windows(0, "major").map((window) => ({ ...window, salience: 0.01 })));
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reasonCodes).toContain("INSUFFICIENT_TONAL_EVIDENCE");
  });
});


describe("tonal bootstrap diagnostics", () => {
  it("reports per-candidate bootstrap rank shares for split relative-key windows", () => {
    const split = [...windows(0, "major", 4), ...windows(9, "minor", 4)];
    const result = resolveTonalCentre(split);
    expect(result.candidates[0]?.bootstrapShare).toBeGreaterThan(0);
    expect(result.candidates.some(candidate => candidate.bootstrapShare > 0 && (
      candidate.tonic !== result.tonic || candidate.mode !== result.mode
    ))).toBe(true);
  });
});
