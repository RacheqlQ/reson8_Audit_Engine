import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildVocalAndSectionPageData } from "../src/audio/vocal-arrangement-analysis.js";
import { generateAuditReportV2 } from "../src/reports/v2/render.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

function voicedMaster(seconds = 5, sampleRate = 16_000): Float32Array {
  const samples = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    samples[i] = (Math.sin(2 * Math.PI * 220 * time)
      + 0.65 * Math.sin(2 * Math.PI * 440 * time)
      + 0.3 * Math.sin(2 * Math.PI * 660 * time)) * 0.08;
  }
  return samples;
}

describe("vocal and section Page 3 report integration", () => {
  it("renders explicit in-process vocal data without changing Sample or Full page counts", async () => {
    const vocalAndSectionPageData = buildVocalAndSectionPageData(voicedMaster(), 16_000, 1);
    expect(vocalAndSectionPageData.provenance).toBe("SIGNAL_DERIVED_NO_STEM_WORKER");
    expect(vocalAndSectionPageData.vocalActivityIntervals.length).toBeGreaterThan(0);
    expect(vocalAndSectionPageData.inferredSections.length).toBeGreaterThan(0);
    expect(vocalAndSectionPageData.vocalF0RangeHz).not.toBeNull();

    const input = {
      ...structuredClone(fullAudioFixture),
      vocalAndSectionPageData,
    } as any;
    const sample = await PDFDocument.load(await generateAuditReportV2(input, "sample"));
    const full = await PDFDocument.load(await generateAuditReportV2(input, "full"));
    expect(sample.getPageCount()).toBe(7);
    expect(full.getPageCount()).toBe(12);
  });
});
