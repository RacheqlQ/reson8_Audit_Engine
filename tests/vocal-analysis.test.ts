import { describe, expect, it } from "vitest";
import { analyzeVocalStem } from "../src/audio/vocal-analysis.js";

describe("acoustic vocal stem analysis", () => {
  it("finds vocal activity intervals and a stable pitch range from a separated singing stem", () => {
    const sampleRate = 8000;
    const mix = Float32Array.from({ length: sampleRate * 3 }, (_, i) =>
      0.5 * Math.sin(2 * Math.PI * 220 * i / sampleRate),
    );
    const vocal = Float32Array.from({ length: sampleRate * 3 }, (_, i) =>
      i < sampleRate * 1.6 ? 0.25 * Math.sin(2 * Math.PI * 220 * i / sampleRate) : 0,
    );

    const result = analyzeVocalStem([vocal], [mix], sampleRate);

    expect(result.status).toBe("analyzed");
    expect(result.voicePresence).toBe("likely_present");
    expect(result.activitySegments.length).toBeGreaterThan(0);
    expect(result.activitySegments[0]?.startSeconds).toBeLessThan(0.15);
    expect(result.activitySegments[0]?.endSeconds).toBeGreaterThan(1.3);
    expect(result.activitySegments[0]?.endSeconds).toBeLessThan(1.9);
    expect(result.pitch.medianHz).toBeGreaterThan(195);
    expect(result.pitch.medianHz).toBeLessThan(245);
    expect(result.delivery).toBe("not_classified");
    expect(result.lyrics).toBe("not_requested");
  });

  it("does not claim vocals when the separated vocal stem contains negligible energy", () => {
    const sampleRate = 8000;
    const mix = Float32Array.from({ length: sampleRate * 2 }, (_, i) =>
      0.4 * Math.sin(2 * Math.PI * 440 * i / sampleRate),
    );
    const silentStem = new Float32Array(mix.length);

    const result = analyzeVocalStem([silentStem], [mix], sampleRate);

    expect(result.status).toBe("analyzed");
    expect(result.voicePresence).toBe("not_detected");
    expect(result.activitySegments).toEqual([]);
    expect(result.pitch.medianHz).toBeNull();
  });

  it("abstains when the source is silent or too short for vocal analysis", () => {
    const result = analyzeVocalStem([new Float32Array(100)], [new Float32Array(100)], 8000);

    expect(result.status).toBe("insufficient_evidence");
    expect(result.voicePresence).toBe("uncertain");
    expect(result.activitySegments).toEqual([]);
    expect(result.limitations.length).toBeGreaterThan(0);
  });
});
