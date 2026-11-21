import { describe, expect, it } from "vitest";
import { estimateKey } from "../src/audio/key-estimation.js";
import { estimateGoertzelKey, estimateLowFrequencyEnvelopeTempo } from "../src/audio/independent-estimators.js";
import { estimateTempo } from "../src/audio/sonic-dna.js";

const SAMPLE_RATE = 8_000;
const DURATION_SECONDS = 8;

function syntheticPulseTrain(bpm: number): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * DURATION_SECONDS);
  const period = Math.round(SAMPLE_RATE * 60 / bpm);
  for (let onset = 0; onset < samples.length; onset += period) {
    for (let offset = 0; offset < Math.min(240, samples.length - onset); offset++) {
      const envelope = Math.exp(-offset / 42);
      samples[onset + offset] += 0.8 * envelope * Math.sin(2 * Math.PI * 1_200 * offset / SAMPLE_RATE);
      samples[onset + offset] += 0.25 * envelope * Math.sin(2 * Math.PI * 82 * offset / SAMPLE_RATE);
    }
  }
  return samples;
}

function syntheticAMinor(): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * DURATION_SECONDS);
  const frequencies = [220, 261.6256, 329.6276, 440];
  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    samples[index] = frequencies.reduce((sum, frequency) =>
      sum + Math.sin(2 * Math.PI * frequency * time), 0) / frequencies.length;
  }
  return samples;
}

describe("zero-cost synthetic audio detector evaluation", () => {
  it("runs primary and independent tempo pathways on a known 120 BPM pulse fixture", () => {
    const fixture = syntheticPulseTrain(120);
    const primary = estimateTempo(fixture, SAMPLE_RATE);
    const independent = estimateLowFrequencyEnvelopeTempo(fixture, SAMPLE_RATE);

    expect(primary.method).toBe("high_frequency_transient_autocorrelation");
    expect(primary).toHaveProperty("abstentionReason");
    expect(independent.method).toBe("low_frequency_energy_envelope_autocorrelation");
    expect(Number.isFinite(independent.score)).toBe(true);
    // Synthetic fixture results are diagnostics, not a real-world accuracy claim.
  });

  it("runs primary and independent key pathways on a known A-minor harmonic fixture", () => {
    const fixture = syntheticAMinor();
    const primary = estimateKey(fixture, SAMPLE_RATE);
    const independent = estimateGoertzelKey(fixture, SAMPLE_RATE);

    expect(primary.method).toBe("fft_harmonic_chroma_ensemble");
    expect(primary).toHaveProperty("limitation");
    expect(independent.method).toBe("goertzel_pitch_frequency_bank");
    expect(Number.isInteger(independent.analyzedPitchCount)).toBe(true);
    // A detector may abstain; the harness records that rather than forcing a label.
  });

  it("records abstention for silence instead of manufacturing a tempo or key", () => {
    const silence = new Float32Array(SAMPLE_RATE * DURATION_SECONDS);
    expect(estimateTempo(silence, SAMPLE_RATE).bpm).toBeNull();
    expect(estimateKey(silence, SAMPLE_RATE).key).toBeNull();
    expect(estimateGoertzelKey(silence, SAMPLE_RATE).key).toBeNull();
  });
});
