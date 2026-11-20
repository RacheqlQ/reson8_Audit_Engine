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


const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function transposedTriad(rootMidi: number, mode: "major" | "minor", cents = 0, seconds = 8, sampleRate = 8000): Float32Array {
  const intervals = mode === "major" ? [0,4,7] : [0,3,7];
  const frequencies = intervals.map(interval => 440 * Math.pow(2, (rootMidi + interval - 69 + cents / 100) / 12));
  return chord(frequencies, seconds, sampleRate);
}

describe("key estimator transposition and tuning robustness", () => {
  it("recovers transposed major and minor triads across all pitch classes", () => {
    for (let root = 0; root < 12; root++) {
      for (const mode of ["major", "minor"] as const) {
        const midi = 60 + root;
        const result = estimateGoertzelKey(transposedTriad(midi, mode), 8000);
        expect(result.key, `root ${NOTE_NAMES[root]} ${mode}`).toBe(NOTE_NAMES[root]);
        expect(result.mode, `root ${NOTE_NAMES[root]} ${mode}`).toBe(mode);
      }
    }
  });

  it("retains a stable pitch-class result with modest global tuning drift", () => {
    const result = estimateGoertzelKey(transposedTriad(65, "minor", 18), 8000);
    expect(result.key).toBe("F");
    expect(result.mode).toBe("minor");
  });
});


describe("key evidence sufficiency and realistic signal limits", () => {
  it("does not infer a major or minor key from a single sustained pitch", () => {
    const sampleRate = 8000;
    const samples = Float32Array.from({ length: sampleRate * 8 }, (_, i) =>
      0.6 * Math.sin(2 * Math.PI * 220 * i / sampleRate),
    );
    const result = estimateGoertzelKey(samples, sampleRate);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
    expect(result.limitation).toMatch(/insufficient|pitch|key/i);
  });

  it("does not infer a tonal center from broadband noise", () => {
    let state = 0x12345678;
    const sampleRate = 8000;
    const samples = Float32Array.from({ length: sampleRate * 8 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return ((state / 0x100000000) * 2 - 1) * 0.2;
    });
    const result = estimateGoertzelKey(samples, sampleRate);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
  });
});
