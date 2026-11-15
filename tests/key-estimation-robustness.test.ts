import { describe, expect, it } from "vitest";
import { estimateKey } from "../src/audio/key-estimation.js";

const RATE = 8000;
function tones(frequencies: number[], seconds = 8, cents = 0): Float32Array {
  const factor = 2 ** (cents / 1200);
  return Float32Array.from({ length: RATE * seconds }, (_, i) =>
    frequencies.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * factor * i / RATE), 0) / frequencies.length,
  );
}
function percussionOnly(seconds = 8): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  let seed = 731;
  for (let beat = 0; beat < seconds * 2; beat++) {
    const start = beat * RATE / 2;
    for (let i = 0; i < RATE * 0.045 && start + i < samples.length; i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      samples[start + i] += noise * Math.exp(-i / (RATE * 0.009)) * 0.7;
    }
  }
  return samples;
}


function harmonicChord(fundamentals: number[], seconds = 8, amplitudes = [0.15, 0.3, 0.5, 0.75, 1]): Float32Array {
  // Upper partials are deliberately stronger than the fundamentals. This
  // fixture must exercise the estimator's stated harmonic-weighting claim.
  const partials = fundamentals.flatMap((fundamental) =>
    [1, 2, 3, 4, 5].map((harmonic) => ({
      frequency: fundamental * harmonic,
      amplitude: amplitudes[harmonic - 1],
    })),
  );
  return Float32Array.from({ length: RATE * seconds }, (_, i) =>
    partials.reduce((sum, partial) =>
      sum + partial.amplitude * Math.sin(2 * Math.PI * partial.frequency * i / RATE), 0,
    ) / partials.length,
  );
}

describe("DSP key estimator — robustness and abstention", () => {
  it("keeps the same key under moderate global tuning offsets", () => {
    for (const cents of [-35, -20, 0, 20, 35]) {
      const result = estimateKey(tones([261.6256, 329.6276, 391.9954], 8, cents), RATE);
      expect(result.key, `tuning offset ${cents} cents`).toBe("C");
      expect(result.mode).toBe("major");
    }
  });

  it("abstains on transient broadband percussion without pitched evidence", () => {
    const result = estimateKey(percussionOnly(), RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
    expect(result.limitation).toMatch(/pitched|tonal|spectral|varied/i);
  });

  it("does not infer a key from unrelated inharmonic partials", () => {
    const result = estimateKey(tones([400.7396, 1016.1641, 1173.6422, 1724.0157, 1762.1191], 8), RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
  });

  it("abstains when successive polyphonic sections have incompatible tonal centres", () => {
    const first = tones([261.6256, 329.6276, 391.9954], 5);
    const second = tones([293.6648, 369.9944, 440], 5);
    const combined = new Float32Array(first.length + second.length);
    combined.set(first);
    combined.set(second, first.length);
    const result = estimateKey(combined, RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
    expect(result.segmentAgreement).toBeLessThan(0.6);
  });

  it("retains the chord root when upper harmonics are stronger than the fundamentals", () => {
    const result = estimateKey(harmonicChord([130.8128, 164.8138, 195.9977]), RATE);
    expect(result.key).toBe("C");
    expect(result.mode).toBe("major");
  });

  it("does not turn one harmonic series into a global musical key via false subharmonic votes", () => {
    const result = estimateKey(harmonicChord([220]).map((sample) => sample), RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
  });

  it("does not promote a weak fundamental's stronger upper partials into false independent roots", () => {
    const result = estimateKey(harmonicChord([220], 8, [0.05, 0.3, 0.5, 0.75, 1]), RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
  });

  it("rejects broadband spectral clutter even when it contains many local peaks", () => {
    let seed = 991;
    const noise = Float32Array.from({ length: RATE * 8 }, () => {
      seed = (seed * 16807) % 2147483647;
      return ((seed / 2147483647) * 2 - 1) * 0.12;
    });
    const result = estimateKey(noise, RATE);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
  });

});
