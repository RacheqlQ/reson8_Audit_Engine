const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
type Mode = "major" | "minor";

export interface IndependentTempoEstimate {
  bpm: number | null;
  score: number;
  method: "low_frequency_energy_envelope_autocorrelation";
  frameCount: number;
  limitation: string | null;
}

export interface IndependentKeyEstimate {
  key: string | null;
  mode: Mode | null;
  score: number;
  margin: number | null;
  method: "goertzel_pitch_frequency_bank";
  analyzedPitchCount: number;
  limitation: string | null;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const EPSILON = 1e-12;

function signalRms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / samples.length);
}

function unavailableTempo(frameCount: number, limitation: string): IndependentTempoEstimate {
  return { bpm: null, score: 0, method: "low_frequency_energy_envelope_autocorrelation", frameCount, limitation };
}

/**
 * Independent tempo pathway: frame-wise energy in a low-frequency band,
 * followed by envelope autocorrelation. It does not reuse transient flux or
 * the whole-clip detector's derivative novelty series.
 */
export function estimateLowFrequencyEnvelopeTempo(
  samples: Float32Array,
  sampleRate: number,
): IndependentTempoEstimate {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < sampleRate * 4 || signalRms(samples) < 1e-5) {
    return unavailableTempo(0, "Insufficient duration or signal energy for low-frequency envelope tempo analysis.");
  }
  const frameSize = Math.max(32, Math.floor(sampleRate * 0.02));
  const frameCount = Math.floor(samples.length / frameSize);
  if (frameCount < 200) return unavailableTempo(frameCount, "Insufficient low-frequency energy frames.");

  // Goertzel-style narrow-band energy accumulation over 45–180 Hz.
  const envelope = new Float64Array(frameCount);
  const frequencies = [55, 70, 82, 95, 110, 130, 150, 175];
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * frameSize;
    let bandEnergy = 0;
    for (const frequency of frequencies) {
      const omega = 2 * Math.PI * frequency / sampleRate;
      const coefficient = 2 * Math.cos(omega);
      let previous = 0;
      let previous2 = 0;
      for (let index = 0; index < frameSize; index++) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frameSize - 1));
        const current = samples[start + index] * window + coefficient * previous - previous2;
        previous2 = previous;
        previous = current;
      }
      const power = Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
      bandEnergy += power;
    }
    envelope[frame] = Math.sqrt(bandEnergy / frequencies.length);
  }

  const mean = envelope.reduce((sum, value) => sum + value, 0) / frameCount;
  const variance = envelope.reduce((sum, value) => sum + (value - mean) ** 2, 0) / frameCount;
  if (mean < 1e-8 || Math.sqrt(variance) < 1e-7) {
    return unavailableTempo(frameCount, "No usable low-frequency energy modulation was detected.");
  }
  // Remove DC and slow baseline variation before measuring periodicity.
  const centered = Float64Array.from(envelope, value => value - mean);
  const minLag = Math.max(1, Math.round(60 / 240 * sampleRate / frameSize));
  const maxLag = Math.min(Math.floor(60 / 40 * sampleRate / frameSize), Math.floor(frameCount / 2));
  let bestLag = 0;
  let bestScore = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let left = 0;
    let right = 0;
    for (let index = lag; index < frameCount; index++) {
      const a = centered[index]!;
      const b = centered[index - lag]!;
      cross += a * b;
      left += a * a;
      right += b * b;
    }
    const score = cross / Math.sqrt(Math.max(EPSILON, left * right));
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!bestLag || bestScore < 0.12) {
    return { ...unavailableTempo(frameCount, "Low-frequency envelope periodicity was too weak to support a tempo estimate."), score: Number(Math.max(0, bestScore).toFixed(6)) };
  }
  const bpm = 60 * sampleRate / (frameSize * bestLag);
  return {
    bpm: Number(bpm.toFixed(2)),
    score: Number(bestScore.toFixed(6)),
    method: "low_frequency_energy_envelope_autocorrelation",
    frameCount,
    limitation: null,
  };
}

function goertzelPower(samples: Float32Array, sampleRate: number, frequency: number): number {
  const omega = 2 * Math.PI * frequency / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;
  for (let index = 0; index < samples.length; index++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (samples.length - 1));
    const current = samples[index]! * window + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
}

function profileCorrelation(profile: readonly number[], template: readonly number[]): number {
  const profileMean = profile.reduce((sum, value) => sum + value, 0) / 12;
  const templateMean = template.reduce((sum, value) => sum + value, 0) / 12;
  let numerator = 0;
  let profileEnergy = 0;
  let templateEnergy = 0;
  for (let index = 0; index < 12; index++) {
    const a = profile[index]! - profileMean;
    const b = template[index]! - templateMean;
    numerator += a * b;
    profileEnergy += a * a;
    templateEnergy += b * b;
  }
  return numerator / Math.sqrt(Math.max(EPSILON, profileEnergy * templateEnergy));
}

/**
 * Independent key pathway: a Goertzel bank measures equal-tempered pitch
 * frequencies directly, then compares the resulting pitch-class profile with
 * major/minor templates. It does not consume FFT peaks or existing chroma.
 */
export function estimateGoertzelKey(samples: Float32Array, sampleRate: number): IndependentKeyEstimate {
  const unavailable = (limitation: string, analyzedPitchCount = 0): IndependentKeyEstimate => ({
    key: null,
    mode: null,
    score: 0,
    margin: null,
    method: "goertzel_pitch_frequency_bank",
    analyzedPitchCount,
    limitation,
  });
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < sampleRate * 2 || signalRms(samples) < 1e-5) {
    return unavailable("Insufficient duration or signal energy for Goertzel key analysis.");
  }
  // Analyze three evenly spaced 2-second excerpts. A full-track Goertzel
  // sweep scales with recording duration and made long-form analysis
  // needlessly expensive; these excerpts bound work while sampling beginning,
  // middle, and end rather than silently truncating to the intro.
  const windowLength = Math.min(samples.length, Math.max(2, Math.floor(sampleRate * 2)));
  const windowCount = Math.min(3, Math.max(1, Math.floor(samples.length / windowLength)));
  const windows: Float32Array[] = [];
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const start = windowCount === 1 ? 0 : Math.round(windowIndex * (samples.length - windowLength) / (windowCount - 1));
    windows.push(samples.subarray(start, start + windowLength));
  }
  const profile = Array(12).fill(0) as number[];
  let analyzedPitchCount = 0;
  for (let midi = 36; midi <= 84; midi++) {
    const nominalFrequency = 440 * Math.pow(2, (midi - 69) / 12);
    if (nominalFrequency >= sampleRate / 2) continue;
    let supportedWindows = 0;
    let accumulatedStrength = 0;
    for (const window of windows) {
      // Search a narrow tuning neighborhood rather than testing only the
      // equal-tempered center. This tolerates modest global tuning drift.
      let peakPower = 0;
      for (let cents = -40; cents <= 40; cents += 10) {
        const candidateFrequency = nominalFrequency * Math.pow(2, cents / 1200);
        peakPower = Math.max(peakPower, goertzelPower(window, sampleRate, candidateFrequency));
      }
      const lowerSide = goertzelPower(window, sampleRate, nominalFrequency * Math.pow(2, -80 / 1200));
      const upperSide = goertzelPower(window, sampleRate, nominalFrequency * Math.pow(2, 80 / 1200));
      const peakAmplitude = Math.sqrt(peakPower);
      const sideFloor = (Math.sqrt(lowerSide) + Math.sqrt(upperSide)) / 2;
      // Require the same pitch class to show a narrow peak in separate
      // excerpts. Independent noise peaks rarely persist at one note across
      // beginning/middle/end, while sustained musical tones do.
      if (peakPower > 1e-10 && peakAmplitude > sideFloor * 1.8) {
        supportedWindows++;
        accumulatedStrength += Math.max(0, peakAmplitude - sideFloor);
      }
    }
    const requiredWindows = windows.length >= 3 ? 2 : 1;
    if (supportedWindows >= requiredWindows) {
      profile[midi % 12] += accumulatedStrength / windows.length;
      analyzedPitchCount++;
    }
  }
  const total = profile.reduce((sum, value) => sum + value, 0);
  const strongestPitchClass = Math.max(...profile);
  const activePitchClasses = profile.filter(value => value >= strongestPitchClass * 0.12 && value > 1e-7).length;
  const probabilities = profile.map(value => total > 0 ? value / total : 0).filter(value => value > 0);
  const pitchClassEntropy = -probabilities.reduce((sum, value) => sum + value * Math.log(value), 0);
  const topThreeShare = [...profile].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0) / Math.max(EPSILON, total);
  if (analyzedPitchCount < 2 || total < 1e-7 || activePitchClasses < 3 || pitchClassEntropy > 2.35 || topThreeShare < 0.34) {
    return unavailable("Pitch-class evidence was sparse or too diffuse to support a stable tonal center.", analyzedPitchCount);
  }
  const normalized = profile.map(value => value / total);
  const candidates: Array<{ key: number; mode: Mode; score: number }> = [];
  for (let key = 0; key < 12; key++) {
    const rotated = normalized.map((_value, index) => normalized[(index + key) % 12]!);
    candidates.push({ key, mode: "major", score: profileCorrelation(rotated, MAJOR_PROFILE) });
    candidates.push({ key, mode: "minor", score: profileCorrelation(rotated, MINOR_PROFILE) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  const second = candidates[1]!;
  if (!Number.isFinite(best.score) || best.score < 0.15 || best.score - second.score < 0.025) {
    return unavailable("Pitch-class profile did not provide a sufficiently distinctive key and mode.", analyzedPitchCount);
  }
  return {
    key: NOTES[best.key]!,
    mode: best.mode,
    score: Number(best.score.toFixed(6)),
    margin: Number((best.score - second.score).toFixed(6)),
    method: "goertzel_pitch_frequency_bank",
    analyzedPitchCount,
    limitation: null,
  };
}
