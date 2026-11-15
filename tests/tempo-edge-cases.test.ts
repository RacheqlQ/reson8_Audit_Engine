import { describe, expect, it } from "vitest";
import { estimateTempo } from "../src/audio/sonic-dna.js";

const RATE = 8000;
function transient(samples: Float32Array, time: number, amplitude: number): void {
  const start = Math.round(time * RATE);
  const length = Math.min(Math.round(RATE * 0.025), samples.length - start);
  for (let i = 0; i < length; i++) {
    samples[start + i] += amplitude * Math.sin(2 * Math.PI * 220 * i / RATE) * Math.exp(-i / (RATE * 0.004));
  }
}
function sparsePercussion(bpm: number, seconds = 12): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  const interval = 60 / bpm;
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    // Alternating sparse accents; the quieter events still carry the beat grid.
    transient(samples, beat * interval, beat % 2 === 0 ? 1 : 0.12);
  }
  return samples;
}
function offbeatAccents(bpm: number, seconds = 12): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  const interval = 60 / bpm;
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    transient(samples, beat * interval, 0.35);
    // Louder eighth-note offbeats intentionally challenge the beat estimate.
    if (beat < seconds * bpm / 60 - 1) transient(samples, beat * interval + interval / 2, 1);
  }
  return samples;
}

describe("tempo edge cases", () => {
  it("retains a plausible tempo candidate for sparse alternating percussion without forcing a single BPM", () => {
    const result = estimateTempo(sparsePercussion(80), RATE);
    expect(result.candidateBpms.some((bpm) => Math.abs(bpm - 80) <= 2 || Math.abs(bpm - 40) <= 2)).toBe(true);
    expect(result.bpm === null || (result.bpm >= 40 && result.bpm <= 240)).toBe(true);
  });

  it("keeps the underlying beat candidate when offbeat accents are louder than downbeats", () => {
    const result = estimateTempo(offbeatAccents(120), RATE);
    expect(result.candidateBpms.some((bpm) => Math.abs(bpm - 120) <= 2 || Math.abs(bpm - 60) <= 2)).toBe(true);
    expect(result.abstentionReason).toBeNull();
  });
});
