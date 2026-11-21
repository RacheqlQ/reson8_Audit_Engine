import { describe, expect, it } from "vitest";
import { sanitizePublicReportLine, sanitizePublicReportLines } from "../src/reports/v2/public-language.js";

describe("public report language", () => {
  it("removes confidence labels without changing the underlying measurement", () => {
    expect(sanitizePublicReportLine("100 BPM · Medium confidence · Uploaded-master tempo evidence"))
      .toBe("100 BPM · Measured from the uploaded recording");
  });

  it("replaces internal key-analysis terminology with a plain-language finding", () => {
    expect(sanitizePublicReportLine("Key method: fft_harmonic_chroma_ensemble · Uploaded-master harmonic evidence"))
      .toBe("");
    expect(sanitizePublicReportLine("Not yet measured: A minor (provisional harmonic candidate; alternatives: F major, D minor; no single key asserted)."))
      .toBe("Song key not confirmed. Possible tonal centres: A minor, F major, D minor.");
  });

  it("removes model, prompt, raw detector and signal-processing diagnostics", () => {
    const lines = sanitizePublicReportLines([
      "Assessment model provenance: gemini / model-x · prompt audit-v6",
      "Primary key raw confidence score: 0.061 (not a calibrated probability).",
      "Tuning offset: -1.57 cents; evidence windows: 5.",
      "Technical descriptors: RMS level -13.2 dBFS · Spectral centroid 1423 Hz.",
      "Primary detector candidates: 96 BPM (score 0.812).",
      "Alternate half/double-time candidate: 192 BPM.",
      "Independent low-frequency envelope estimate: 95.8 BPM.",
      "Primary tonal candidates: A minor (score 0.710).",
      "Verify the release title across music platforms."
    ]);
    expect(lines).toEqual(["Verify the release title across music platforms."]);
  });

  it("never prints any confidence wording in public report text", () => {
    expect(sanitizePublicReportLine("High confidence · Confidence: 0.91 · confidence-qualified key"))
      .not.toMatch(/confidence/i);
  });
});
