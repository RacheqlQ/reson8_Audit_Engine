import { describe, expect, it } from "vitest";
import {
  estimateGoertzelKey,
  estimateLowFrequencyEnvelopeTempo,
} from "../src/audio/independent-estimators.js";

function lowPulse(bpm: number, seconds = 24, sampleRate = 8000): Float32Array {
  const samples = new Float32Array(sampleRate * seconds);
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    const start = Math.round(beat * 60 / bpm * sampleRate);
    const length = Math.min(Math.round(sampleRate * 0.12), samples.length - start);
    for (let i = 0; i < length; i++) {
      samples[start + i] += 0.7 * Math.sin(2 * Math.PI * 82 * i / sampleRate)
        * Math.exp(-i / (sampleRate * 0.035));
    }
  }
  return samples;
}

function chord(frequencies: number[], seconds = 12, sampleRate = 8000): Float32Array {
  return Float32Array.from({ length: sampleRate * seconds }, (_, i) =>
    frequencies.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * i / sampleRate), 0)
      / frequencies.length,
  );
}

describe("independent acoustic estimator pathways", () => {
  it("estimates tempo from a low-frequency energy envelope, independently of transient derivative autocorrelation", () => {
    const result = estimateLowFrequencyEnvelopeTempo(lowPulse(100), 8000);
    expect(result.bpm).toBe(100);
    expect(result.score).toBeGreaterThan(0);
  });

  it("estimates key with a Goertzel pitch-frequency bank rather than FFT peak-chroma voting", () => {
    const result = estimateGoertzelKey(chord([261.6256, 329.6276, 391.9954]), 8000);
    expect(result.key).toBe("C");
    expect(result.mode).toBe("major");
    expect(result.score).toBeGreaterThan(0);
  });

  it("abstains on silence for both independent pathways", () => {
    const silence = new Float32Array(8000 * 12);
    expect(estimateLowFrequencyEnvelopeTempo(silence, 8000).bpm).toBeNull();
    expect(estimateGoertzelKey(silence, 8000).key).toBeNull();
  });
});
