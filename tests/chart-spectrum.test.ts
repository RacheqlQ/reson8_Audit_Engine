import { describe, expect, it } from "vitest";
import { spectrumScaleForValue } from "../src/reports/charts.js";

describe("tempo spectrum scale", () => {
  it("does not expose a numeric BPM scale when tempo is withheld", () => {
    expect(spectrumScaleForValue("TEMPO", null)).toBeNull();
    expect(spectrumScaleForValue("BPM", undefined)).toBeNull();
  });

  it("retains the BPM scale for a finite measured tempo", () => {
    expect(spectrumScaleForValue("TEMPO", 120)).toEqual({ min: 60, max: 180, unit: "BPM" });
  });

  it("keeps non-tempo scales available when their values are withheld", () => {
    expect(spectrumScaleForValue("RMS ENERGY", null)).toEqual({ min: 0, max: 1, unit: "" });
  });
});
