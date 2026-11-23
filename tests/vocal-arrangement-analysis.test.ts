import { describe, expect, it } from "vitest";
import {
  analyzeVocalArrangement,
  detectVocalActivityIntervals,
  estimateF0Candidates,
  segmentArrangement,
  type AnalysisWindow,
} from "../src/audio/vocal-arrangement-analysis.js";

function tone(hz: number, seconds: number, sampleRate = 16_000, amplitude = 0.25): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate);
  return samples;
}

function join(...parts: Float32Array[]): Float32Array {
  const output = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function voicedTone(fundamentalHz: number, seconds: number, sampleRate = 16_000): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  const harmonics = [1, 0.65, 0.38, 0.2, 0.1];
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    samples[i] = harmonics.reduce((sum, amplitude, index) =>
      sum + amplitude * Math.sin(2 * Math.PI * fundamentalHz * (index + 1) * time), 0
    ) * 0.08;
  }
  return samples;
}

describe("in-process vocal and arrangement signal analysis", () => {
  it("tracks 70–500 Hz F0 candidates and summarizes the median/range without claiming a singer", () => {
    const sampleRate = 16_000;
    const candidates = estimateF0Candidates(join(tone(220, 1, sampleRate), tone(330, 1, sampleRate), tone(440, 1, sampleRate)), sampleRate);
    expect(candidates.length).toBeGreaterThan(5);
    expect(candidates.every(value => value >= 70 && value <= 500)).toBe(true);
    const median = [...candidates].sort((a, b) => a - b)[Math.floor(candidates.length / 2)]!;
    expect(median).toBeGreaterThan(200);
    expect(median).toBeLessThan(450);
  });

  it("merges adjacent active windows and preserves timestamped vocal-band intervals", () => {
    const windows: AnalysisWindow[] = [
      { startSeconds: 0, endSeconds: 0.1, rmsDbfs: -18, midBandRatio: 0.4, harmonicity: 0.8, spectralFlux: 0.1, chroma: [], vocalActivity: true },
      { startSeconds: 0.1, endSeconds: 0.2, rmsDbfs: -18, midBandRatio: 0.4, harmonicity: 0.8, spectralFlux: 0.1, chroma: [], vocalActivity: true },
      { startSeconds: 0.2, endSeconds: 0.3, rmsDbfs: -40, midBandRatio: 0.05, harmonicity: 0.1, spectralFlux: 0.01, chroma: [], vocalActivity: false },
      { startSeconds: 0.3, endSeconds: 0.4, rmsDbfs: -18, midBandRatio: 0.4, harmonicity: 0.8, spectralFlux: 0.1, chroma: [], vocalActivity: true },
    ];
    expect(detectVocalActivityIntervals(windows, 0.4)).toEqual([
      { startSeconds: 0, endSeconds: 0.2 },
      { startSeconds: 0.3, endSeconds: 0.4 },
    ]);
  });

  it("segments arrangement from spectral, energy and vocal-state changes with ordered transitions", () => {
    const windows: AnalysisWindow[] = [];
    for (let i = 0; i < 90; i++) {
      const phase = Math.floor(i / 30);
      windows.push({
        startSeconds: i * 0.5, endSeconds: (i + 1) * 0.5,
        rmsDbfs: phase === 1 ? -10 : -24,
        midBandRatio: phase === 1 ? 0.45 : 0.12,
        harmonicity: phase === 1 ? 0.8 : 0.25,
        spectralFlux: i % 30 === 0 && i > 0 ? 0.8 : 0.02,
        chroma: Array.from({ length: 12 }, (_, n) => n === phase * 4 ? 1 : 0),
        vocalActivity: phase === 1,
      });
    }
    const result = segmentArrangement(windows, 45);
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    expect(result.transitions.length).toBeGreaterThanOrEqual(1);
    expect(result.sections[0]?.startSeconds).toBe(0);
    expect(result.sections.at(-1)?.endSeconds).toBe(45);
    expect(result.transitions.every((item, index) => index === 0 || item.timestampSeconds > result.transitions[index - 1]!.timestampSeconds)).toBe(true);
    expect(result.transitions.every(item => item.reason.length > 0 && item.fromLabel.length > 0 && item.toLabel.length > 0)).toBe(true);
  });

  it("returns bounded signal-derived vocal activity and candidate F0 on a tonal master", () => {
    const sampleRate = 16_000;
    const samples = join(voicedTone(220, 3, sampleRate), new Float32Array(sampleRate * 2));
    const result = analyzeVocalArrangement(samples, sampleRate, 1);
    expect(result.provenance).toBe("SIGNAL_DERIVED_FROM_UPLOADED_MASTER");
    expect(result.vocalPresencePct).toBeGreaterThan(0);
    expect(result.vocalPresencePct).toBeLessThanOrEqual(100);
    expect(result.vocalActivityIntervals.length).toBeGreaterThan(0);
    expect(result.vocalMedianF0Hz).not.toBeNull();
    expect(result.vocalF0RangeHz).not.toBeNull();
    expect(result.inferredSections.length).toBeGreaterThan(0);
    expect(result.detectedTransitions.length).toBeGreaterThanOrEqual(0);
    expect(result.limitations.join(" ")).toMatch(/not proof|not confirmation/i);
  });

  it("gracefully abstains on silence without blank or fabricated pitch values", () => {
    const result = analyzeVocalArrangement(new Float32Array(16_000 * 3), 16_000, 1);
    expect(result.vocalPresencePct).toBe(0);
    expect(result.vocalMedianF0Hz).toBeNull();
    expect(result.vocalF0RangeHz).toBeNull();
    expect(result.vocalActivityIntervals).toEqual([]);
    expect(result.analysisReason).toMatch(/silence|insufficient|low/i);
    expect(result.inferredSections.length).toBeGreaterThan(0);
  });
});
