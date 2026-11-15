export interface KeyEstimate {
  key: string | null;
  mode: "major" | "minor" | null;
  confidence: number | null;
  tuningCents: number | null;
  segmentAgreement: number | null;
  method: "fft_harmonic_chroma_ensemble";
  analysisWindows: number;
  fftButterflyCount: number;
  limitation: string | null;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FRAME_SIZE = 4096;
const MAX_WINDOWS = 12;
const MIN_FREQUENCY_HZ = 55;
const MAX_FREQUENCY_HZ = 2000;
const EPSILON = 1e-12;

const KRUMHANSL = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const TEMPERLEY = {
  major: [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 2.5],
  minor: [5.0, 2.0, 3.5, 4.5, 2.0, 3.5, 2.0, 4.5, 3.5, 2.0, 3.5, 2.0],
};
const DIATONIC = {
  major: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1],
  minor: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0],
};
const PENTATONIC = {
  major: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
  minor: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0],
};

type Mode = "major" | "minor";
interface Candidate { key: number; mode: Mode; score: number; }

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function fft(real: Float64Array, imaginary: Float64Array): number {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  let operations = 0;
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let j = 0; j < length / 2; j++) {
        const even = offset + j;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
        operations += 1;
      }
    }
  }
  return operations;
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  if (!values.length) return 0;
  values.sort((a, b) => a.value - b.value);
  const total = values.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of values) {
    cumulative += entry.weight;
    if (cumulative >= total / 2) return entry.value;
  }
  return values[values.length - 1].value;
}


function isHarmonicOf(
  upper: { frequency: number; magnitude: number },
  lower: { frequency: number; magnitude: number },
): boolean {
  if (lower.frequency >= upper.frequency) return false;
  const ratio = upper.frequency / lower.frequency;
  const harmonic = Math.round(ratio);
  return harmonic >= 2 && harmonic <= 8 && Math.abs(ratio - harmonic) / harmonic <= 0.03;
}

function fundamentalPeaks(peaks: Array<{ frequency: number; magnitude: number }>): Array<{ frequency: number; magnitude: number }> {
  const strongest = peaks.reduce((maximum, peak) => Math.max(maximum, peak.magnitude), 0);
  const crediblePeaks = peaks.filter((peak) => peak.magnitude >= strongest * 0.08);

  // A weak fundamental below the 8% voting floor must still be allowed to
  // explain a coherent series of stronger upper partials. It is not itself
  // admitted as a key vote; it only prevents those partials becoming false
  // independent roots when the fundamental is weak.
  const supportedWeakRoots = peaks.filter((lower) =>
    lower.magnitude < strongest * 0.08
      && peaks.filter((upper) => isHarmonicOf(upper, lower)).length >= 2,
  );
  const harmonicAnchors = [...crediblePeaks, ...supportedWeakRoots];

  return crediblePeaks.filter((peak) =>
    !harmonicAnchors.some((lower) => isHarmonicOf(peak, lower)),
  );
}

function tuningOffset(peaks: Array<{ frequency: number; magnitude: number }>): number {
  const offsets = peaks.map((peak) => {
    const midi = 69 + 12 * Math.log2(peak.frequency / 440);
    return { value: (midi - Math.round(midi)) * 100, weight: peak.magnitude };
  }).filter((entry) => Math.abs(entry.value) <= 50);
  return Math.max(-50, Math.min(50, weightedMedian(offsets)));
}

function tuningDeviationCents(peaks: Array<{ frequency: number; magnitude: number }>, offsetCents: number): number {
  const deviations = peaks.map((peak) => {
    const midi = 69 + 12 * Math.log2(peak.frequency / 440);
    const cents = (midi - Math.round(midi)) * 100;
    return { value: Math.abs(cents - offsetCents), weight: peak.magnitude };
  }).filter((entry) => Number.isFinite(entry.value) && entry.value <= 100);
  return weightedMedian(deviations);
}

function profileForSegment(samples: Float32Array, start: number, sampleRate: number): {
  chroma: number[];
  peaks: Array<{ frequency: number; magnitude: number }>;
  fftButterflyCount: number;
} {
  const real = new Float64Array(FRAME_SIZE);
  const imaginary = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
    real[i] = samples[start + i] * hann;
  }
  const operations = fft(real, imaginary);
  const magnitudes = new Float64Array(FRAME_SIZE / 2 + 1);
  const maxBin = Math.min(FRAME_SIZE / 2 - 1, Math.floor(MAX_FREQUENCY_HZ * FRAME_SIZE / sampleRate));
  for (let bin = 1; bin <= maxBin; bin++) magnitudes[bin] = Math.hypot(real[bin], imaginary[bin]);
  const peaks: Array<{ frequency: number; magnitude: number }> = [];
  for (let bin = 2; bin < maxBin; bin++) {
    const magnitude = magnitudes[bin];
    if (magnitude <= magnitudes[bin - 1] || magnitude < magnitudes[bin + 1] || magnitude < 1e-7) continue;
    const left = Math.log(Math.max(EPSILON, magnitudes[bin - 1]));
    const center = Math.log(Math.max(EPSILON, magnitude));
    const right = Math.log(Math.max(EPSILON, magnitudes[bin + 1]));
    const denominator = left - 2 * center + right;
    const adjustment = Math.abs(denominator) > EPSILON
      ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator))
      : 0;
    peaks.push({
      frequency: (bin + adjustment) * sampleRate / FRAME_SIZE,
      magnitude,
    });
  }

  const fundamentals = fundamentalPeaks(peaks);
  // A single harmonic series is evidence of a pitched note, not a musical key.
  // Count independent spectral roots before harmonic/subharmonic chroma voting.
  if (fundamentals.length < 2) {
    return { chroma: Array(12).fill(0), peaks: [], fftButterflyCount: operations };
  }
  const tuningCents = tuningOffset(fundamentals);
  // A stable global tuning offset should explain independent tonal roots.
  // Do not compare upper harmonics as if each were an independent note.
  if (fundamentals.length >= 4 && tuningDeviationCents(fundamentals, tuningCents) > 30) {
    return { chroma: Array(12).fill(0), peaks: [], fftButterflyCount: operations };
  }
  const bassChroma = Array(12).fill(0);
  const midChroma = Array(12).fill(0);
  for (const peak of fundamentals) {
    const correctedHz = peak.frequency / Math.pow(2, tuningCents / 1200);
    if (correctedHz < MIN_FREQUENCY_HZ || correctedHz > MAX_FREQUENCY_HZ) continue;
    const midi = 69 + 12 * Math.log2(correctedHz / 440);
    const pitchClass = (Math.round(midi) % 12 + 12) % 12;
    const target = correctedHz < 250 ? bassChroma : midChroma;
    const bandWeight = correctedHz < 1000 ? 1 : 0.65;
    const peakWeight = Math.pow(peak.magnitude, 0.8) * bandWeight;
    target[pitchClass] += peakWeight;

    // Harmonic peaks are excluded from chroma voting above. Guessing
    // subharmonics from independent roots can create unsupported pitch classes.
  }
  const chroma = bassChroma.map((value, index) => value * 0.55 + midChroma[index] * 0.45);
  return { chroma, peaks: fundamentals, fftButterflyCount: operations };
}

function correlation(profile: readonly number[], template: readonly number[]): number {
  const profileMean = profile.reduce((sum, value) => sum + value, 0) / 12;
  const templateMean = template.reduce((sum, value) => sum + value, 0) / 12;
  let numerator = 0;
  let profileEnergy = 0;
  let templateEnergy = 0;
  for (let i = 0; i < 12; i++) {
    const a = profile[i] - profileMean;
    const b = template[i] - templateMean;
    numerator += a * b;
    profileEnergy += a * a;
    templateEnergy += b * b;
  }
  return numerator / Math.sqrt(Math.max(EPSILON, profileEnergy * templateEnergy));
}

function scoreCandidate(chroma: readonly number[], key: number, mode: Mode): number {
  const rotated = chroma.map((_, index) => chroma[(index + key) % 12]);
  return correlation(rotated, KRUMHANSL[mode]) * 0.35
    + correlation(rotated, TEMPERLEY[mode]) * 0.3
    + correlation(rotated, DIATONIC[mode]) * 0.2
    + correlation(rotated, PENTATONIC[mode]) * 0.15;
}

function rankCandidates(chroma: readonly number[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (let key = 0; key < 12; key++) {
    for (const mode of ["major", "minor"] as const) {
      candidates.push({ key, mode, score: scoreCandidate(chroma, key, mode) });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function emptyEstimate(limitation: string): KeyEstimate {
  return {
    key: null, mode: null, confidence: null, tuningCents: null,
    segmentAgreement: null, method: "fft_harmonic_chroma_ensemble",
    analysisWindows: 0, fftButterflyCount: 0, limitation,
  };
}

export function estimateKey(samples: Float32Array, sampleRate: number): KeyEstimate {
  if (sampleRate <= 0 || samples.length < sampleRate * 2 || rms(samples) < 1e-5) {
    return emptyEstimate("Insufficient pitched audio or signal energy for reliable key estimation.");
  }
  if (samples.length < FRAME_SIZE) {
    return emptyEstimate("Audio is shorter than the minimum key-analysis frame.");
  }

  const hop = FRAME_SIZE / 2;
  const possibleWindows = Math.floor((samples.length - FRAME_SIZE) / hop) + 1;
  const windowCount = Math.min(MAX_WINDOWS, possibleWindows);
  const aggregate = Array(12).fill(0);
  const segmentProfiles: number[][] = [];
  const segmentWinners: Candidate[] = [];
  const tuningValues: Array<{ value: number; weight: number }> = [];
  let fftButterflyCount = 0;

  for (let window = 0; window < windowCount; window++) {
    const selectedWindow = windowCount === 1
      ? 0
      : Math.round(window * (possibleWindows - 1) / (windowCount - 1));
    const start = selectedWindow * hop;
    const result = profileForSegment(samples, start, sampleRate);
    fftButterflyCount += result.fftButterflyCount;
    const total = result.chroma.reduce((sum, value) => sum + value, 0);
    if (total <= EPSILON) continue;
    const normalized = result.chroma.map((value) => value / total);
    for (let pitch = 0; pitch < 12; pitch++) aggregate[pitch] += normalized[pitch];
    segmentProfiles.push(normalized);
    const best = rankCandidates(normalized)[0];
    if (best) segmentWinners.push(best);
    if (result.peaks.length) {
      const offset = tuningOffset(result.peaks);
      tuningValues.push({ value: offset, weight: result.peaks.reduce((sum, peak) => sum + peak.magnitude, 0) });
    }
  }

  if (!segmentProfiles.length) return emptyEstimate("No stable pitched spectral peaks were detected for key estimation.");
  const aggregateTotal = aggregate.reduce((sum, value) => sum + value, 0);
  if (aggregateTotal <= EPSILON) return emptyEstimate("No stable tonal energy was detected for key estimation.");
  const normalizedAggregate = aggregate.map((value) => value / aggregateTotal);
  const ranked = rankCandidates(normalizedAggregate);
  const best = ranked[0];
  const second = ranked[1];
  const agreement = segmentWinners.filter((winner) => winner.key === best.key && winner.mode === best.mode).length / segmentWinners.length;
  const margin = best.score - second.score;
  const confidence = clamp((margin * 2.5 + 0.08) * (0.35 + 0.65 * agreement));
  const tuningCents = tuningValues.length ? weightedMedian(tuningValues) : 0;

  if (agreement < 0.6) {
    return {
      key: null, mode: null, confidence, tuningCents, segmentAgreement: agreement,
      method: "fft_harmonic_chroma_ensemble", analysisWindows: segmentProfiles.length,
      fftButterflyCount, limitation: "Key estimates varied across audio segments; no single key is asserted.",
    };
  }
  if (confidence < 0.12 || margin < 0.015) {
    return {
      key: null, mode: null, confidence, tuningCents, segmentAgreement: agreement,
      method: "fft_harmonic_chroma_ensemble", analysisWindows: segmentProfiles.length,
      fftButterflyCount, limitation: "Key and mode confidence was below threshold; no key is asserted.",
    };
  }
  return {
    key: NOTES[best.key], mode: best.mode, confidence, tuningCents,
    segmentAgreement: agreement, method: "fft_harmonic_chroma_ensemble",
    analysisWindows: segmentProfiles.length, fftButterflyCount, limitation: null,
  };
}
