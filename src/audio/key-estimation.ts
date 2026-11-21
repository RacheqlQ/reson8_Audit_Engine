import { bootstrapCategoricalConsensus, type BootstrapConsensusDiagnostics } from "./ensemble-consensus.js";
import { resolveTonalCentre, type TonalResolution, type TonalWindow } from "./tonal-resolution.js";

export interface KeySegmentDiagnostic {
  startSeconds: number;
  endSeconds: number;
  chroma: number[];
  winningKey: string | null;
  winningMode: "major" | "minor" | null;
  winningScore: number | null;
}

export interface KeyEstimate {
  key: string | null;
  mode: "major" | "minor" | null;
  confidence: number | null;
  tuningCents: number | null;
  segmentAgreement: number | null;
  method: "fft_harmonic_chroma_ensemble";
  analysisWindows: number;
  fftButterflyCount: number;
  segmentChroma: KeySegmentDiagnostic[];
  topCandidates: Array<{ key: string; mode: Mode; score: number }>;
  tuningEvidenceWindows: number;
  limitation: string | null;
  windowConsensus: BootstrapConsensusDiagnostics;
  tonalResolution: TonalResolution;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const CIRCLE_OF_FIFTHS_PITCH_CLASSES = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5] as const;

/** Root support from the tonic and its adjacent fourth/fifth neighbours on the circle of fifths. */
export function circleOfFifthsRootScore(bassChroma: readonly number[], tonic: number): number {
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11 || bassChroma.length !== 12) return 0;
  const total = bassChroma.reduce((sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value) : 0), 0);
  if (total <= EPSILON) return 0;
  const position = CIRCLE_OF_FIFTHS_PITCH_CLASSES.findIndex(value => value === tonic);
  const fifth = CIRCLE_OF_FIFTHS_PITCH_CLASSES[(position + 1) % 12]!;
  const fourth = CIRCLE_OF_FIFTHS_PITCH_CLASSES[(position + 11) % 12]!;
  const at = (pitch: number) => Math.max(0, bassChroma[pitch] ?? 0) / total;
  return at(tonic) * 0.6 + at(fifth) * 0.25 + at(fourth) * 0.15;
}
const FRAME_SIZE = 4096;
const MAX_WINDOWS = 16;
const MIN_FREQUENCY_HZ = 35;
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

export const MIN_RELIABLE_KEY_CONFIDENCE = 0.8;
export const MIN_KEY_SEGMENT_AGREEMENT = 0.8;
// Internal candidate-retention floors are deliberately lower than reportability gates.
// Candidates remain provisional until they pass the stricter evidence guardrails.
const MIN_KEY_CANDIDATE_CONFIDENCE = 0.12;
const MIN_KEY_CANDIDATE_SEGMENT_AGREEMENT = 0.7;

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

function analyzeFundamentalPeaks(peaks: Array<{ frequency: number; magnitude: number }>): {
  fundamentals: Array<{ frequency: number; magnitude: number }>;
  supportedWeakRoots: Array<{ frequency: number; magnitude: number }>;
} {
  const strongest = peaks.reduce((maximum, peak) => Math.max(maximum, peak.magnitude), 0);
  const crediblePeaks = peaks.filter((peak) => peak.magnitude >= strongest * 0.08);

  // A weak fundamental below the 8% voting floor can still explain a coherent
  // series of stronger upper partials. It is not itself admitted as a key vote.
  const supportedWeakRoots = peaks.filter((lower) =>
    lower.frequency < 250
      && lower.magnitude < strongest * 0.08
      && peaks.filter((upper) => isHarmonicOf(upper, lower)).length >= 3,
  );
  const harmonicAnchors = [...crediblePeaks, ...supportedWeakRoots];
  const fundamentals = crediblePeaks.filter((peak) =>
    !harmonicAnchors.some((lower) => isHarmonicOf(peak, lower)),
  );
  return { fundamentals, supportedWeakRoots };
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
  bassChroma: number[];
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

  const { fundamentals, supportedWeakRoots } = analyzeFundamentalPeaks(peaks);
  // A single harmonic series is evidence of a pitched note, not a musical key.
  // Count independent spectral roots before harmonic-aware chroma voting.
  if (fundamentals.length < 2) {
    return { chroma: Array(12).fill(0), bassChroma: Array(12).fill(0), peaks: [], fftButterflyCount: operations };
  }
  const tuningCents = tuningOffset(peaks);
  // A stable global tuning offset should explain independent tonal roots.
  // Do not compare upper harmonics as if each were an independent note.
  if (peaks.length >= 4 && tuningDeviationCents(peaks, tuningCents) > 30) {
    return { chroma: Array(12).fill(0), bassChroma: Array(12).fill(0), peaks: [], fftButterflyCount: operations };
  }
  const bassChroma = Array(12).fill(0);
  const midChroma = Array(12).fill(0);
  for (const peak of peaks) {
    // A weak fundamental below the root-voting floor may explain several
    // stronger partials. Those partials must not become independent notes.
    if (supportedWeakRoots.some((lower) => isHarmonicOf(peak, lower))) continue;

    const supportingRoot = fundamentals.find((lower) => isHarmonicOf(peak, lower));
    const harmonicNumber = supportingRoot
      ? Math.round(peak.frequency / supportingRoot.frequency)
      : 1;
    const harmonicWeight = supportingRoot ? 0.12 / harmonicNumber : 1;
    const correctedHz = peak.frequency / Math.pow(2, tuningCents / 1200);
    if (correctedHz < MIN_FREQUENCY_HZ || correctedHz > MAX_FREQUENCY_HZ) continue;
    const midi = 69 + 12 * Math.log2(correctedHz / 440);
    const pitchClass = (Math.round(midi) % 12 + 12) % 12;
    const target = correctedHz < 250 ? bassChroma : midChroma;
    const bandWeight = correctedHz < 1000 ? 1 : 0.65;
    const peakWeight = Math.pow(peak.magnitude, 0.8) * bandWeight * harmonicWeight;
    target[pitchClass] += peakWeight;

    // Retain a small subharmonic contribution to help distinguish sparse
    // segmental tonal profiles; its source peak's harmonic weight is applied
    // first so strong partials cannot overwhelm independent roots.
    for (let harmonic = 2; harmonic <= 4; harmonic++) {
      const subharmonicHz = correctedHz / harmonic;
      if (subharmonicHz < MIN_FREQUENCY_HZ || subharmonicHz > 1000) continue;
      const subharmonicMidi = 69 + 12 * Math.log2(subharmonicHz / 440);
      const subharmonicClass = (Math.round(subharmonicMidi) % 12 + 12) % 12;
      const subharmonicTarget = subharmonicHz < 250 ? bassChroma : midChroma;
      subharmonicTarget[subharmonicClass] += peakWeight * (0.12 / harmonic);
    }
  }
  const chroma = bassChroma.map((value, index) => value * 0.55 + midChroma[index] * 0.45);
  return { chroma, bassChroma, peaks, fftButterflyCount: operations };
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

function scoreCandidate(chroma: readonly number[], key: number, mode: Mode, bassChroma: readonly number[] = []): number {
  const rotated = chroma.map((_, index) => chroma[(index + key) % 12]);
  const profileScore = correlation(rotated, KRUMHANSL[mode]) * 0.35
    + correlation(rotated, TEMPERLEY[mode]) * 0.3
    + correlation(rotated, DIATONIC[mode]) * 0.2
    + correlation(rotated, PENTATONIC[mode]) * 0.15;
  // A modest tonic anchor rewards bass support for the proposed root and its
  // circle-of-fifths neighbours. It never overrides conflicting sections.
  return profileScore + circleOfFifthsRootScore(bassChroma, key) * 0.08;
}

function diatonicChordQualities(key: number, mode: Mode): Map<number, Mode> {
  const intervals = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const qualities: Mode[] = mode === "major"
    ? ["major", "minor", "minor", "major", "major", "minor", "minor"]
    : ["minor", "minor", "major", "minor", "minor", "major", "major"];
  return new Map(intervals.map((interval, degree) => [(key + interval) % 12, qualities[degree]!]));
}

function rankCandidates(chroma: readonly number[], bassChroma: readonly number[] = []): Candidate[] {
  const candidates: Candidate[] = [];
  for (let key = 0; key < 12; key++) {
    for (const mode of ["major", "minor"] as const) {
      candidates.push({ key, mode, score: scoreCandidate(chroma, key, mode, bassChroma) });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function emptyEstimate(limitation: string): KeyEstimate {
  return {
    key: null, mode: null, confidence: null, tuningCents: null,
    segmentAgreement: null, method: "fft_harmonic_chroma_ensemble",
    analysisWindows: 0, fftButterflyCount: 0, segmentChroma: [], topCandidates: [], tuningEvidenceWindows: 0, limitation,
    windowConsensus: bootstrapCategoricalConsensus([]),
    tonalResolution: resolveTonalCentre([]),
  };
}

export function estimateKey(
  samples: Float32Array,
  sampleRate: number,
  downbeatCandidateTimesSeconds: readonly number[] = [],
): KeyEstimate {
  if (sampleRate <= 0 || samples.length < sampleRate * 2 || rms(samples) < 1e-5) {
    return emptyEstimate("Insufficient pitched audio or signal energy for reliable key estimation.");
  }
  if (samples.length < FRAME_SIZE) {
    return emptyEstimate("Audio is shorter than the minimum key-analysis frame.");
  }

  const durationSeconds = samples.length / sampleRate;
  const targetWindowSeconds = durationSeconds >= 12 ? 12 : durationSeconds;
  const windowSamples = Math.min(samples.length, Math.max(FRAME_SIZE, Math.floor(sampleRate * targetWindowSeconds)));
  const windowHop = Math.max(FRAME_SIZE, Math.floor(windowSamples / 2));
  const windowStarts: number[] = [];
  if (samples.length <= windowSamples) windowStarts.push(0);
  else {
    for (let start = 0; start + windowSamples <= samples.length; start += windowHop) windowStarts.push(start);
    const finalStart = samples.length - windowSamples;
    if (windowStarts[windowStarts.length - 1] !== finalStart) windowStarts.push(finalStart);
  }
  const boundedStarts = windowStarts.length > MAX_WINDOWS
    ? Array.from({ length: MAX_WINDOWS }, (_, index) => windowStarts[Math.round(index * (windowStarts.length - 1) / (MAX_WINDOWS - 1))]!)
    : windowStarts;
  const segmentProfiles: number[][] = [];
  const segmentWinners: Candidate[] = [];
  const segmentChroma: KeySegmentDiagnostic[] = [];
  const tonalWindows: TonalWindow[] = [];
  const tuningValues: Array<{ value: number; weight: number }> = [];
  let fftButterflyCount = 0;

  for (let window = 0; window < boundedStarts.length; window++) {
    const start = boundedStarts[window]!;
    const end = Math.min(samples.length, start + windowSamples);
    const frameHop = Math.max(FRAME_SIZE / 2, Math.floor(sampleRate * 0.5));
    const chromaAggregate = Array(12).fill(0);
    const bassAggregate = Array(12).fill(0);
    const downbeatBassAggregate = Array(12).fill(0);
    let downbeatFrameCount = 0;
    let frameWeightTotal = 0;
    let salienceTotal = 0;
    let energyTotal = 0;
    let tuningWindowWeight = 0;
    let tuningWindowOffset = 0;

    for (let frameStart = start; frameStart + FRAME_SIZE <= end; frameStart += frameHop) {
      const frame = samples.subarray(frameStart, frameStart + FRAME_SIZE);
      const frameEnergy = rms(frame);
      if (frameEnergy < 1e-5) continue;
      const result = profileForSegment(samples, frameStart, sampleRate);
      fftButterflyCount += result.fftButterflyCount;
      const chromaTotal = result.chroma.reduce((sum, value) => sum + value, 0);
      if (chromaTotal <= EPSILON || result.peaks.length < 2) continue;
      const normalizedFrame = result.chroma.map(value => value / chromaTotal);
      const normalizedBassFrame = result.bassChroma.map(value => value / Math.max(EPSILON, result.bassChroma.reduce((sum, value) => sum + value, 0)));
      let entropy = 0;
      for (const value of normalizedFrame) if (value > EPSILON) entropy -= value * Math.log(value);
      const tonalConcentration = clamp(1 - entropy / Math.log(12));
      const harmonicClarity = Math.max(0.15, clamp(result.peaks.length / 8));
      const salience = clamp(tonalConcentration * harmonicClarity);
      // Percussive/noisy frames below the same salience floor used by the
      // resolver do not contribute chroma votes or bass-root anchors.
      if (salience < 0.12) continue;
      const frameWeight = frameEnergy * salience;
      for (let pitch = 0; pitch < 12; pitch++) {
        chromaAggregate[pitch] += normalizedFrame[pitch]! * frameWeight;
        bassAggregate[pitch] += normalizedBassFrame[pitch]! * frameWeight;
      }
      // Tempo-derived beat-four positions are candidates, not verified downbeats.
      // Use them only as a soft bass anchor when several strong candidate frames
      // agree on one low-frequency root; otherwise leave the anchor unset.
      const frameTime = frameStart / sampleRate;
      if (downbeatCandidateTimesSeconds.some(time => Number.isFinite(time) && Math.abs(frameTime - time) <= 0.15)) {
        downbeatFrameCount += 1;
        for (let pitch = 0; pitch < 12; pitch++) {
          downbeatBassAggregate[pitch] += normalizedBassFrame[pitch]! * frameWeight;
        }
      }
      frameWeightTotal += frameWeight;
      salienceTotal += salience * frameWeight;
      energyTotal += frameEnergy * frameWeight;
      if (result.peaks.length) {
        const offset = tuningOffset(result.peaks);
        const weight = result.peaks.reduce((sum, peak) => sum + peak.magnitude, 0);
        tuningWindowOffset += offset * weight;
        tuningWindowWeight += weight;
      }
    }

    if (frameWeightTotal <= EPSILON) continue;
    const chromaTotal = chromaAggregate.reduce((sum, value) => sum + value, 0);
    const bassTotal = bassAggregate.reduce((sum, value) => sum + value, 0);
    if (chromaTotal <= EPSILON) continue;
    const normalized = chromaAggregate.map(value => value / chromaTotal);
    const normalizedBass = bassTotal > EPSILON ? bassAggregate.map(value => value / bassTotal) : Array(12).fill(0);
    const salience = salienceTotal / frameWeightTotal;
    const windowEnergy = energyTotal / frameWeightTotal;
    const downbeatBassTotal = downbeatBassAggregate.reduce((sum, value) => sum + value, 0);
    const downbeatRootIndex = downbeatBassAggregate.reduce((best, value, index, values) => value > values[best]! ? index : best, 0);
    const downbeatRoot = downbeatFrameCount >= 2 && downbeatBassTotal > EPSILON
      && downbeatBassAggregate[downbeatRootIndex]! / downbeatBassTotal >= 0.45
      ? downbeatRootIndex : null;
    const best = rankCandidates(normalized, normalizedBass)[0];
    segmentProfiles.push(normalized);
    if (best) segmentWinners.push(best);
    segmentChroma.push({
      startSeconds: Number((start / sampleRate).toFixed(4)),
      endSeconds: Number((end / sampleRate).toFixed(4)),
      chroma: normalized.map(value => Number(value.toFixed(6))),
      winningKey: best ? NOTES[best.key] : null,
      winningMode: best?.mode ?? null,
      winningScore: best ? Number(best.score.toFixed(6)) : null,
    });
    tonalWindows.push({
      startSeconds: start / sampleRate,
      endSeconds: end / sampleRate,
      chroma: normalized,
      bassChroma: normalizedBass,
      salience,
      energy: windowEnergy,
      downbeatRoot: downbeatRoot !== null && normalizedBass[downbeatRoot]! >= 0.2 ? downbeatRoot : null,
      cadenceWeight: window === boundedStarts.length - 1 ? 0.65 : 0,
    });
    if (tuningWindowWeight > EPSILON) {
      tuningValues.push({ value: tuningWindowOffset / tuningWindowWeight, weight: tuningWindowWeight });
    }
  }

  if (!segmentProfiles.length) return emptyEstimate("No stable pitched spectral peaks were detected for key estimation.");
  const tonalResolution = resolveTonalCentre(tonalWindows);
  const aggregate = Array(12).fill(0);
  const aggregateBass = Array(12).fill(0);
  for (const window of tonalWindows) {
    const weight = Math.max(EPSILON, window.salience * Math.max(0.05, window.energy ?? 1));
    const chroma = window.chroma;
    const bass = window.bassChroma ?? Array(12).fill(0);
    for (let pitch = 0; pitch < 12; pitch++) {
      aggregate[pitch] += chroma[pitch]! * weight;
      aggregateBass[pitch] += bass[pitch]! * weight;
    }
  }
  const ranked = rankCandidates(aggregate, aggregateBass);
  const best = ranked[0];
  const second = ranked[1];
  const margin = best && second ? best.score - second.score : 0;
  const agreement = tonalResolution.windowAgreement;
  const confidence = best && second && agreement !== null
    ? clamp((margin * 2.5 + 0.08) * (0.35 + 0.65 * agreement))
    : null;
  const tuningCents = tuningValues.length ? weightedMedian(tuningValues) : 0;
  const topCandidates = tonalResolution.candidates.slice(0, 5).map(candidate => ({
    key: candidate.tonic,
    mode: candidate.mode,
    score: candidate.score,
  }));
  const reasonDescriptions: Record<string, string> = {
    INSUFFICIENT_TONAL_EVIDENCE: "Stable harmonic evidence is insufficient.",
    LOW_WINDOW_CONSENSUS: "A stable window consensus was not reached across the analyzed audio segments.",
    LOW_BOOTSTRAP_CONSENSUS: "Resampled candidate rankings are not stable enough for confirmation.",
    LOW_RUNNER_UP_MARGIN: "The leading candidate is too close to its runner-up.",
    RELATIVE_MAJOR_MINOR_AMBIGUITY: "Relative major and minor readings remain close.",
    ADJACENT_FIFTHS_AMBIGUITY: "Adjacent Circle of Fifths candidates remain close.",
  };
  const limitation = tonalResolution.status === "CONFIRMED"
    ? null
    : tonalResolution.status === "UNAVAILABLE"
      ? "Insufficient tonal evidence; no tonic or mode can be asserted."
      : "The tonal centre remains provisional. " + tonalResolution.reasonCodes
        .map(code => reasonDescriptions[code] ?? "A tonal disambiguation check remains unresolved.")
        .join(" ");
  return {
    // Only confirmed results populate the legacy key/mode fields. Provisional
    // candidates remain available through tonalResolution and topCandidates.
    key: tonalResolution.status === "CONFIRMED" ? tonalResolution.tonic : null,
    mode: tonalResolution.status === "CONFIRMED" ? tonalResolution.mode : null,
    confidence,
    tuningCents,
    segmentAgreement: agreement,
    method: "fft_harmonic_chroma_ensemble",
    analysisWindows: segmentProfiles.length,
    fftButterflyCount,
    segmentChroma,
    topCandidates,
    tuningEvidenceWindows: tuningValues.length,
    limitation,
    windowConsensus: bootstrapCategoricalConsensus(segmentWinners.map(winner => `${NOTES[winner.key]}:${winner.mode}`)),
    tonalResolution,
  };
}
