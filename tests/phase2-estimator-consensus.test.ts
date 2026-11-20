import { describe, expect, it } from "vitest";
import { analyzePcm, estimateTempo } from "../src/audio/sonic-dna.js";

function pulse(bpm: number, seconds = 24, sampleRate = 8000): Float32Array {
  const samples = new Float32Array(sampleRate * seconds);
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    const start = Math.round(beat * 60 / bpm * sampleRate);
    const length = Math.min(Math.round(sampleRate * 0.025), samples.length - start);
    for (let i = 0; i < length; i++) {
      samples[start + i] += Math.sin(2 * Math.PI * 220 * i / sampleRate) * Math.exp(-i / (sampleRate * 0.004));
    }
  }
  return samples;
}

function chord(frequencies: number[], seconds = 12, sampleRate = 8000): Float32Array {
  return Float32Array.from({ length: sampleRate * seconds }, (_, i) =>
    frequencies.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * i / sampleRate), 0) / frequencies.length,
  );
}

describe("Phase 2 estimator window consensus", () => {
  it("exposes separate tempo-window consensus diagnostics without treating BPM alternatives as votes", () => {
    const result = estimateTempo(pulse(120), 8000);
    expect(result.windowConsensus).toMatchObject({
      method: "deterministic_window_bootstrap",
      windowCount: expect.any(Number),
      winner: expect.any(String),
    });
    expect(result.windowConsensus.windowCount).toBeGreaterThan(1);
    expect(result.windowConsensus.observedAgreement).toBeGreaterThanOrEqual(0.5);
  });

  it("exposes key-window bootstrap diagnostics alongside the existing chroma ensemble", () => {
    const result = analyzePcm(chord([261.6256, 329.6276, 391.9954]), 8000);
    expect(result.harmonicFeatures).toMatchObject({
      windowConsensus: {
        method: "deterministic_window_bootstrap",
        winner: "C:major",
      },
    });
    expect(result.key).toBe("C");
  });

  it("does not claim tempo window consensus when the signal has insufficient evidence", () => {
    const result = estimateTempo(new Float32Array(8000 * 8), 8000);
    expect(result.windowConsensus.winner).toBeNull();
    expect(result.windowConsensus.observedAgreement).toBeNull();
  });

  it("abstains when independent audio pathways disagree by an unresolved half-time/double-time factor", () => {
    const sampleRate = 8000;
    const seconds = 24;
    const samples = pulse(120, seconds, sampleRate);
    // A 60 BPM low-frequency pulse coexists with 120 BPM high-frequency attacks.
    // Without meter/context evidence, audio periodicity alone cannot safely
    // decide whether the perceived beat is 60 or 120 BPM.
    for (let beat = 0; beat < seconds; beat++) {
      const start = Math.round(beat * sampleRate);
      const length = Math.min(Math.round(sampleRate * 0.12), samples.length - start);
      for (let i = 0; i < length; i++) {
        samples[start + i] += 0.7 * Math.sin(2 * Math.PI * 82 * i / sampleRate)
          * Math.exp(-i / (sampleRate * 0.035));
      }
    }
    const result = estimateTempo(samples, sampleRate);
    expect(result.bpm).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.abstentionReason).toMatch(/half.time|double.time|octave|ambiguous/i);
    expect(result.alternateTempo).not.toBeNull();
  });

});
