import { describe, expect, it } from "vitest";
import { preparePcmForWorker, MAX_ANALYSIS_SAMPLES } from "../src/audio/sonic-dna.js";

describe("Sonic DNA worker PCM preparation", () => {
  it("copies only the bounded mono analysis signal and preserves the full source buffer", () => {
    const source = Float32Array.from({ length: MAX_ANALYSIS_SAMPLES + 1 }, (_, index) => Math.sin(index / 17));
    const sourceBuffer = source.buffer;
    const prepared = preparePcmForWorker(source, 44100, 1);

    expect(prepared.samples.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
    expect(prepared.samples.buffer).not.toBe(sourceBuffer);
    expect(source.length).toBe(MAX_ANALYSIS_SAMPLES + 1);
    expect(source[0]).toBe(0);
    expect(prepared.sampleRate).toBe(22050);
    expect(prepared.channels).toBe(1);
    expect(prepared.durationSeconds).toBeCloseTo(source.length / 44100, 6);
  });

  it("does not transfer the original buffer for short mono masters either", () => {
    const source = Float32Array.from([0.1, -0.2, 0.3, -0.4]);
    const prepared = preparePcmForWorker(source, 44100, 1);

    expect(prepared.samples).not.toBe(source);
    expect(prepared.samples.buffer).not.toBe(source.buffer);
    expect([...prepared.samples]).toEqual([...source]);
    expect(prepared.sampleRate).toBe(44100);
    expect(prepared.channels).toBe(1);
  });

  it("downmixes stereo and bounds the worker transfer without mutating the interleaved source", () => {
    const source = new Float32Array((MAX_ANALYSIS_SAMPLES + 1) * 2);
    for (let frame = 0; frame <= MAX_ANALYSIS_SAMPLES; frame++) {
      source[frame * 2] = 0.25;
      source[frame * 2 + 1] = -0.25;
    }
    const prepared = preparePcmForWorker(source, 44100, 2);

    expect(prepared.samples.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
    expect(prepared.sampleRate).toBe(22050);
    expect(prepared.channels).toBe(1);
    expect(prepared.durationSeconds).toBeCloseTo((MAX_ANALYSIS_SAMPLES + 1) / 44100, 6);
    expect(source[0]).toBe(0.25);
    expect(source[1]).toBe(-0.25);
    expect(prepared.samples[0]).toBeCloseTo(0, 6);
  });
});
