import { describe, expect, it } from "vitest";
import { estimateKey } from "../src/audio/key-estimation.js";

function chord(frequencies: number[], seconds = 6, sampleRate = 8000, cents = 0): Float32Array {
  const tuning = Math.pow(2, cents / 1200);
  return Float32Array.from({ length: sampleRate * seconds }, (_, index) =>
    frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * tuning * index / sampleRate), 0) / frequencies.length,
  );
}

describe("DSP key estimator", () => {
  it("detects a synthetic C major triad", () => {
    const result = estimateKey(chord([261.6256, 329.6276, 391.9954]), 8000);
    expect(result.key).toBe("C");
    expect(result.mode).toBe("major");
    expect(result.confidence).toBeGreaterThan(0.12);
  });

  it("detects a synthetic A minor triad", () => {
    const result = estimateKey(chord([220, 261.6256, 329.6276]), 8000);
    expect(result.key).toBe("A");
    expect(result.mode).toBe("minor");
  });

  it("estimates tuning offset for a detuned synthetic chord", () => {
    const result = estimateKey(chord([261.6256, 329.6276, 391.9954], 6, 8000, 23), 8000);
    expect(result.key).toBe("C");
    expect(result.tuningCents).not.toBeNull();
    expect(result.tuningCents as number).toBeGreaterThan(8);
    expect(result.tuningCents as number).toBeLessThan(38);
  });

  it("abstains when synthetic sections disagree tonally", () => {
    const first = chord([261.6256, 329.6276, 391.9954], 6);
    const second = chord([369.9944, 466.1638, 554.3653], 6);
    const combined = new Float32Array(first.length + second.length);
    combined.set(first);
    combined.set(second, first.length);
    const result = estimateKey(combined, 8000);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
    expect(result.limitation).toContain("varied across audio segments");
  });

  it("returns an explicit limitation for silence", () => {
    const result = estimateKey(new Float32Array(48000), 8000);
    expect(result.key).toBeNull();
    expect(result.mode).toBeNull();
    expect(result.limitation).toContain("Insufficient pitched audio");
  });

  it("stays within the deterministic FFT operation budget", () => {
    const samples = chord([261.6256, 329.6276, 391.9954], 68, 44100);
    const result = estimateKey(samples, 44100);
    expect(result.analysisWindows).toBeLessThanOrEqual(12);
    expect(result.operationCount).toBeLessThanOrEqual(500_000);
    console.info("[key-estimator:synthetic-benchmark]", JSON.stringify({
      durationSeconds: 68,
      windows: result.analysisWindows,
      operationCount: result.operationCount,
      method: result.method,
      realWorldAccuracyClaim: false,
    }));
  });
});
