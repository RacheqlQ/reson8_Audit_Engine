import { describe, expect, it } from "vitest";
import { analyzePcm } from "../src/audio/sonic-dna.js";

const RATE = 8000;
function pulse(bpm: number, seconds = 12): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  const interval = 60 / bpm;
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    const start = Math.round(beat * interval * RATE);
    const length = Math.min(Math.round(RATE * 0.025), samples.length - start);
    for (let i = 0; i < length; i++) {
      samples[start + i] += Math.sin(2 * Math.PI * 220 * i / RATE) * Math.exp(-i / (RATE * 0.004));
    }
  }
  return samples;
}
function chord(frequencies: number[], seconds = 8): Float32Array {
  return Float32Array.from({ length: RATE * seconds }, (_, i) =>
    frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * i / RATE), 0) / frequencies.length,
  );
}

describe("bounded audio diagnostics", () => {
  it("captures a normalized, downsampled onset envelope and tentative beat/downbeat grids", () => {
    const result = analyzePcm(pulse(120), RATE);
    const rhythm = result.rhythmFeatures;
    const envelope = rhythm.onsetEnvelope as number[];
    const beats = rhythm.beatTimesSeconds as number[];
    const downbeats = rhythm.downbeatCandidateTimesSeconds as number[];

    expect(envelope.length).toBeGreaterThan(0);
    expect(envelope.length).toBeLessThanOrEqual(128);
    expect(envelope.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(rhythm.candidateScores).toEqual(expect.arrayContaining([
      expect.objectContaining({ bpm: expect.any(Number), score: expect.any(Number) }),
    ]));
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.length).toBeLessThanOrEqual(512);
    expect(beats.every((time) => time >= 0 && time < 12)).toBe(true);
    expect(downbeats).toEqual(beats.filter((_time, index) => index % 4 === 0));
    expect(rhythm.beatGridStatus).toBe("tentative");
    expect(rhythm.downbeatGridAssumption).toBe("four-beat grouping for diagnostics only");
  });

  it("captures normalized per-segment chroma and tuning without storing PCM", () => {
    const result = analyzePcm(chord([261.6256, 329.6276, 391.9954]), RATE);
    const harmonic = result.harmonicFeatures;
    const segments = harmonic.segmentChroma as Array<{
      startSeconds: number; endSeconds: number; chroma: number[];
      winningKey: string | null; winningMode: string | null;
    }>;

    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThanOrEqual(12);
    for (const segment of segments) {
      expect(segment.endSeconds).toBeGreaterThan(segment.startSeconds);
      expect(segment.chroma).toHaveLength(12);
      expect(segment.chroma.every(Number.isFinite)).toBe(true);
      expect(segment.chroma.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 4);
    }
    expect(typeof harmonic.tuningCents).toBe("number");
    expect(JSON.stringify({ rhythm, harmonic })).not.toContain("samples");
    expect(JSON.stringify({ rhythm, harmonic })).not.toContain("audioBytes");
  });
});
