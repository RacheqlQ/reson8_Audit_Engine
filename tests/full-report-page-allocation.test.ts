import { describe, expect, it } from "vitest";
import { partitionFullReportUnits } from "../src/reports/v2/render.js";

describe("full report page allocation", () => {
  it("balances ordered content by measured height instead of heuristic weights", () => {
    const units = ["large-a", "small-a", "small-b", "large-b", "small-c", "small-d"];
    const pages = partitionFullReportUnits(units, [400, 100, 100, 400, 100, 100], 2, 500);
    expect(pages).toEqual([["large-a", "small-a", "small-b"], ["large-b", "small-c", "small-d"]]);
  });

  it("keeps every unit exactly once and rejects content that cannot fit the fixed page count", () => {
    const units = ["a", "b", "c", "d"];
    const pages = partitionFullReportUnits(units, [300, 300, 300, 300], 2, 500);
    expect(pages).toBeNull();
  });

  it("creates exactly the requested number of non-empty ordered pages", () => {
    const units = ["a", "b", "c", "d", "e"];
    const pages = partitionFullReportUnits(units, [80, 90, 70, 100, 60], 3, 200);
    expect(pages).toHaveLength(3);
    expect(pages?.flat()).toEqual(units);
    expect(pages?.every(page => page.length > 0)).toBe(true);
    expect(pages?.every(page => page.reduce((sum, unit) => sum + [80,90,70,100,60][units.indexOf(unit)], 0) <= 200)).toBe(true);
  });
});
