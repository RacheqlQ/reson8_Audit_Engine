export type VocalActivityInterval = { startSeconds: number; endSeconds: number };
export type InferredArrangementSection = {
  index: number;
  label: string;
  startSeconds: number;
  endSeconds: number;
  provisional: true;
};
export type DetectedArrangementTransition = {
  id: string;
  timestampSeconds: number;
  fromLabel: string;
  toLabel: string;
  reason: "Vocal onset" | "Vocal offset" | "Vocal re-entry" | "Energy rise" | "Energy drop" | "Spectral change";
};
export type AnalysisWindow = {
  startSeconds: number;
  endSeconds: number;
  rmsDbfs: number;
  midBandRatio: number;
  harmonicity: number;
  spectralFlux: number;
  chroma: number[];
  vocalActivity: boolean;
};
export type VocalArrangementAnalysis = {
  schemaVersion: "1.0.0";
  provenance: "SIGNAL_DERIVED_FROM_UPLOADED_MASTER";
  method: "WINDOWED_FFT_MID_BAND_SALIENCE_AND_AUTOCORRELATION";
  analysisStatus: "MEASURED_SIGNAL" | "INSUFFICIENT_SIGNAL";
  vocalActivityStatus: "SIGNAL_ACTIVITY_DETECTED" | "LOW_VOCAL_ACTIVITY";
  vocalPresencePct: number;
  vocalBandEnergyDbfs: number | null;
  vocalMedianF0Hz: number | null;
  vocalF0RangeHz: { p10: number; p90: number } | null;
  vocalActivityIntervals: VocalActivityInterval[];
  inferredSections: InferredArrangementSection[];
  detectedTransitions: DetectedArrangementTransition[];
  analysisWindowCount: number;
  activeWindowCount: number;
  analysisReason: string;
  labelBasis: string;
  limitations: string[];
};

const FFT_SIZE = 2048;
const HOP_SIZE = 1024;
const MAX_ANALYSIS_SAMPLES = 3_000_000;
const MAX_PITCH_FRAMES = 512;
const EPSILON = 1e-12;
const MIN_F0_HZ = 70;
const MAX_F0_HZ = 500;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = real[i]!; real[i] = real[j]!; real[j] = r;
      const im = imag[i]!; imag[i] = imag[j]!; imag[j] = im;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle), stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wr = 1, wi = 0;
      for (let offset = 0; offset < length / 2; offset++) {
        const even = start + offset, odd = even + length / 2;
        const oddReal = real[odd]! * wr - imag[odd]! * wi;
        const oddImag = real[odd]! * wi + imag[odd]! * wr;
        const evenReal = real[even]!, evenImag = imag[even]!;
        real[even] = evenReal + oddReal; imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal; imag[odd] = evenImag - oddImag;
        const nextWr = wr * stepReal - wi * stepImag;
        wi = wr * stepImag + wi * stepReal; wr = nextWr;
      }
    }
  }
}

function monoPcm(samples: Float32Array, sampleRate: number, channels: number): { samples: Float32Array; sampleRate: number } {
  const channelCount = Number.isInteger(channels) && channels > 0 ? channels : 1;
  const frames = Math.floor(samples.length / channelCount);
  const stride = Math.max(1, Math.ceil(frames / MAX_ANALYSIS_SAMPLES));
  if (channelCount === 1 && stride === 1 && frames === samples.length) return { samples, sampleRate };
  const output = new Float32Array(Math.ceil(frames / stride));
  for (let out = 0; out < output.length; out++) {
    const first = out * stride, last = Math.min(frames, first + stride);
    let sum = 0;
    for (let frame = first; frame < last; frame++) {
      let channelsSum = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        const value = samples[frame * channelCount + channel] ?? 0;
        channelsSum += Number.isFinite(value) ? value : 0;
      }
      sum += channelsSum / channelCount;
    }
    output[out] = sum / Math.max(1, last - first);
  }
  return { samples: output, sampleRate: sampleRate / stride };
}

function frameF0(samples: Float32Array, start: number, sampleRate: number, frameLength = FFT_SIZE): number | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000 || start < 0 || start + frameLength > samples.length) return null;
  const downsample = sampleRate >= 12_000 ? 2 : 1;
  const rate = sampleRate / downsample;
  const length = Math.floor(frameLength / downsample);
  const frame = new Float64Array(length);
  let mean = 0;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let k = 0; k < downsample; k++) sum += samples[start + i * downsample + k] ?? 0;
    frame[i] = sum / downsample;
    mean += frame[i]!;
  }
  mean /= length;
  let energy = 0;
  for (let i = 0; i < length; i++) { frame[i] -= mean; energy += frame[i]! * frame[i]!; }
  if (energy / length < 1e-8) return null;
  const minLag = Math.max(2, Math.floor(rate / MAX_F0_HZ));
  const maxLag = Math.min(length - 3, Math.ceil(rate / MIN_F0_HZ));
  if (maxLag <= minLag) return null;
  const correlations = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0, left = 0, right = 0;
    for (let i = 0; i < length - lag; i++) {
      const a = frame[i]!, b = frame[i + lag]!;
      cross += a * b; left += a * a; right += b * b;
    }
    correlations[lag] = cross / Math.sqrt(Math.max(EPSILON, left * right));
  }
  let selectedLag = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = correlations[lag]!;
    if (value >= 0.55 && value >= correlations[lag - 1]! && value >= correlations[lag + 1]!) {
      selectedLag = lag;
      break;
    }
  }
  if (!selectedLag) return null;
  const left = correlations[selectedLag - 1]!, center = correlations[selectedLag]!, right = correlations[selectedLag + 1]!;
  const denominator = left - 2 * center + right;
  const correction = Math.abs(denominator) > EPSILON ? 0.5 * (left - right) / denominator : 0;
  const refinedLag = selectedLag + Math.max(-0.5, Math.min(0.5, correction));
  const hz = rate / refinedLag;
  return hz >= MIN_F0_HZ && hz <= MAX_F0_HZ ? hz : null;
}

/** F0 candidates from the uploaded mono master. These are periodicity candidates, not confirmed human-voice pitches. */
export function estimateF0Candidates(samples: Float32Array, sampleRate: number): number[] {
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000 || samples.length < FFT_SIZE) return [];
  const hop = Math.max(1, Math.floor(sampleRate * 0.08));
  const available = Math.floor((samples.length - FFT_SIZE) / hop) + 1;
  const count = Math.min(MAX_PITCH_FRAMES, available);
  const candidates: number[] = [];
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.floor(i * (available - 1) / (count - 1));
    const pitch = frameF0(samples, index * hop, sampleRate);
    if (pitch !== null) candidates.push(pitch);
  }
  return candidates;
}

export function detectVocalActivityIntervals(windows: AnalysisWindow[], durationSeconds: number): VocalActivityInterval[] {
  const active = windows.filter(window => window.vocalActivity);
  if (!active.length) return [];
  const intervals: VocalActivityInterval[] = [];
  for (const window of active) {
    const previous = intervals[intervals.length - 1];
    if (previous && window.startSeconds <= previous.endSeconds + 0.001) {
      previous.endSeconds = Math.min(durationSeconds, Math.max(previous.endSeconds, window.endSeconds));
    } else {
      intervals.push({
        startSeconds: Math.max(0, window.startSeconds),
        endSeconds: Math.min(durationSeconds, window.endSeconds),
      });
    }
  }
  return intervals.filter(interval => interval.endSeconds > interval.startSeconds);
}

function cosineDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  return aa <= EPSILON || bb <= EPSILON ? 0 : 1 - dot / Math.sqrt(aa * bb);
}

function median(values: number[]): number {
  const result = percentile(values, 0.5);
  return result ?? 0;
}

function sectionSignature(windows: AnalysisWindow[]): number[] {
  if (!windows.length) return [];
  const chroma = Array.from({ length: 12 }, (_, i) => windows.reduce((sum, window) => sum + (window.chroma[i] ?? 0), 0) / windows.length);
  const rms = windows.reduce((sum, window) => sum + window.rmsDbfs, 0) / windows.length;
  const vocal = windows.filter(window => window.vocalActivity).length / windows.length;
  const harmonicity = windows.reduce((sum, window) => sum + window.harmonicity, 0) / windows.length;
  return [...chroma, (rms + 60) / 60, vocal, harmonicity];
}

function assignSectionLabels(sections: InferredArrangementSection[], windows: AnalysisWindow[]): void {
  const groups = sections.map((section, index) => windows.filter(window =>
    window.startSeconds >= section.startSeconds && window.startSeconds < section.endSeconds
  ));
  if (sections.length === 1) {
    const activity = groups[0]!.filter(window => window.vocalActivity).length / Math.max(1, groups[0]!.length);
    sections[0]!.label = activity < 0.08 ? "Instrumental / loop" : "Section 1";
    return;
  }
  sections[0]!.label = "Intro";
  sections[sections.length - 1]!.label = "Outro";
  const inner = sections.map((section, index) => ({ section, index, group: groups[index]! }))
    .filter(item => item.index > 0 && item.index < sections.length - 1);
  if (!inner.length) return;
  const activity = (group: AnalysisWindow[]) => group.filter(window => window.vocalActivity).length / Math.max(1, group.length);
  const energy = (group: AnalysisWindow[]) => group.reduce((sum, window) => sum + window.rmsDbfs, 0) / Math.max(1, group.length);
  const activeInner = inner.filter(item => activity(item.group) >= 0.12);
  if (!activeInner.length) {
    for (const item of inner) item.section.label = "Instrumental / loop";
    return;
  }
  const chorus = [...activeInner].sort((a, b) =>
    (activity(b.group) * 0.7 + (energy(b.group) + 60) / 60 * 0.3)
    - (activity(a.group) * 0.7 + (energy(a.group) + 60) / 60 * 0.3)
  )[0]!;
  chorus.section.label = "Chorus";
  const chorusSignature = sectionSignature(chorus.group);
  let verseNumber = 0;
  for (const item of inner) {
    if (item.index === chorus.index) continue;
    if (activity(item.group) < 0.08) {
      item.section.label = "Instrumental / loop";
      continue;
    }
    const similarity = 1 - cosineDistance(sectionSignature(item.group), chorusSignature);
    if (similarity >= 0.9 && item.index > chorus.index) {
      item.section.label = "Final chorus";
    } else if (item.index < chorus.index) {
      verseNumber++;
      item.section.label = item.index === chorus.index - 1 && item.index > 1 ? "Pre-chorus" : "Verse " + verseNumber;
    } else {
      item.section.label = "Bridge";
    }
  }
  if (inner.length < 2) {
    for (const item of inner) if (item.section.label === "Verse 1") item.section.label = "Section " + (item.index + 1);
  }
  // Low evidence remains a generic section label instead of forcing verse/chorus form.
  for (const item of inner) {
    const group = item.group;
    const spread = group.length ? Math.max(...group.map(w => w.rmsDbfs)) - Math.min(...group.map(w => w.rmsDbfs)) : 0;
    if (group.length < 4 || (activity(group) < 0.12 && spread < 2)) item.section.label = "Section " + (item.index + 1);
  }
}

export function segmentArrangement(windows: AnalysisWindow[], durationSeconds: number): {
  sections: InferredArrangementSection[];
  transitions: DetectedArrangementTransition[];
} {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (!duration) return { sections: [], transitions: [] };
  if (!windows.length) {
    return { sections: [{ index: 1, label: "Section 1", startSeconds: 0, endSeconds: duration, provisional: true }], transitions: [] };
  }
  const fluxValues = windows.map(window => window.spectralFlux);
  const fluxMedian = median(fluxValues);
  const deviations = fluxValues.map(value => Math.abs(value - fluxMedian));
  const fluxThreshold = Math.max(0.12, fluxMedian + 3 * median(deviations));
  const raw: Array<{ time: number; reason: DetectedArrangementTransition["reason"]; strength: number }> = [];
  for (let i = 2; i < windows.length - 2; i++) {
    const previous = windows[i - 1]!, current = windows[i]!;
    const energyDelta = current.rmsDbfs - previous.rmsDbfs;
    const chromaShift = cosineDistance(previous.chroma, current.chroma);
    const vocalChanged = current.vocalActivity !== previous.vocalActivity;
    const fluxChanged = current.spectralFlux >= fluxThreshold;
    let reason: DetectedArrangementTransition["reason"] | null = null;
    let strength = 0;
    if (vocalChanged) {
      const previouslyActive = windows.slice(0, i).some(window => window.vocalActivity);
      reason = current.vocalActivity ? (previouslyActive ? "Vocal re-entry" : "Vocal onset") : "Vocal offset";
      strength = 4;
    } else if (energyDelta >= 4) {
      reason = "Energy rise"; strength = energyDelta;
    } else if (energyDelta <= -4) {
      reason = "Energy drop"; strength = Math.abs(energyDelta);
    } else if (fluxChanged || chromaShift >= 0.3) {
      reason = "Spectral change"; strength = Math.max(current.spectralFlux, chromaShift);
    }
    if (reason) raw.push({ time: current.startSeconds, reason, strength });
  }
  raw.sort((a, b) => a.time - b.time || b.strength - a.strength);
  const selected: typeof raw = [];
  for (const candidate of raw) {
    const previous = selected[selected.length - 1];
    if (previous && candidate.time - previous.time < 5) {
      if (candidate.strength > previous.strength) selected[selected.length - 1] = candidate;
    } else selected.push(candidate);
  }
  const boundaries = [0, ...selected.map(item => item.time).filter(time => time > 0 && time < duration), duration];
  const sections: InferredArrangementSection[] = boundaries.slice(0, -1).map((start, index) => ({
    index: index + 1, label: "Section " + (index + 1), startSeconds: start,
    endSeconds: boundaries[index + 1]!, provisional: true,
  }));
  assignSectionLabels(sections, windows);
  const transitions = selected.filter(item => item.time > 0 && item.time < duration).map((item, index) => ({
    id: "T" + (index + 1), timestampSeconds: item.time,
    fromLabel: sections[index]?.label ?? "Section " + (index + 1),
    toLabel: sections[index + 1]?.label ?? "Section " + (index + 2),
    reason: item.reason,
  }));
  return { sections, transitions };
}

function analyzeWindow(samples: Float32Array, start: number, sampleRate: number, previousMagnitudes: number[] | null): {
  window: AnalysisWindow; midRmsDbfs: number; magnitudes: number[];
} {
  const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
  let sumSquares = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    const value = samples[start + i] ?? 0;
    sumSquares += value * value;
    real[i] = value * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  }
  fft(real, imag);
  const magnitudes: number[] = [];
  let totalPower = 0, midPower = 0, flatnessLog = 0, flatnessArithmetic = 0;
  let weighted = 0, totalMagnitude = 0;
  const chroma = new Array<number>(12).fill(0);
  for (let bin = 1; bin <= FFT_SIZE / 2; bin++) {
    const magnitude = Math.hypot(real[bin]!, imag[bin]!);
    const hz = bin * sampleRate / FFT_SIZE;
    const power = magnitude * magnitude;
    magnitudes.push(magnitude);
    totalPower += power;
    totalMagnitude += magnitude;
    weighted += hz * magnitude;
    if (hz >= 250 && hz <= 3500) {
      midPower += power;
      flatnessLog += Math.log(Math.max(EPSILON, magnitude));
      flatnessArithmetic += magnitude;
      if (hz >= 55) {
        const midi = 69 + 12 * Math.log2(hz / 440);
        const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pitchClass] = (chroma[pitchClass] ?? 0) + power;
      }
    }
  }
  const binsInBand = Math.max(1, Math.floor(3500 / (sampleRate / FFT_SIZE)) - Math.ceil(250 / (sampleRate / FFT_SIZE)));
  const flatness = flatnessArithmetic > EPSILON
    ? Math.exp(flatnessLog / binsInBand) / (flatnessArithmetic / binsInBand) : 1;
  const harmonicity = Math.max(0, Math.min(1, 1 - flatness));
  const midBandRatio = totalPower > EPSILON ? midPower / totalPower : 0;
  const rms = Math.sqrt(sumSquares / FFT_SIZE);
  const midRms = rms * Math.sqrt(midBandRatio);
  const midRmsDbfs = 20 * Math.log10(Math.max(EPSILON, midRms));
  const rmsDbfs = 20 * Math.log10(Math.max(EPSILON, rms));
  const spectralFlux = previousMagnitudes && previousMagnitudes.length === magnitudes.length
    ? magnitudes.reduce((sum, value, index) => sum + Math.max(0, value - previousMagnitudes[index]!), 0)
      / Math.max(EPSILON, magnitudes.reduce((sum, value) => sum + value, 0))
    : 0;
  const chromaNorm = Math.sqrt(chroma.reduce((sum, value) => sum + value * value, 0));
  const normalizedChroma = chromaNorm > EPSILON ? chroma.map(value => value / chromaNorm) : chroma;
  const vocalActivity = midBandRatio >= 0.12 && midRmsDbfs >= -48 && harmonicity >= 0.42;
  return {
    window: {
      startSeconds: start / sampleRate, endSeconds: (start + FFT_SIZE) / sampleRate,
      rmsDbfs, midBandRatio, harmonicity, spectralFlux, chroma: normalizedChroma, vocalActivity,
    },
    midRmsDbfs, magnitudes,
  };
}

/**
 * Zero-cost whole-master signal analysis. Vocal-band activity and F0 are
 * inferred proxies: periodic instruments can satisfy the same thresholds.
 */
export function analyzeVocalArrangement(samples: Float32Array, sampleRate: number, channels = 1): VocalArrangementAnalysis {
  const empty = (durationSeconds: number, reason: string): VocalArrangementAnalysis => ({
    schemaVersion: "1.0.0", provenance: "SIGNAL_DERIVED_FROM_UPLOADED_MASTER",
    method: "WINDOWED_FFT_MID_BAND_SALIENCE_AND_AUTOCORRELATION",
    analysisStatus: "INSUFFICIENT_SIGNAL", vocalActivityStatus: "LOW_VOCAL_ACTIVITY",
    vocalPresencePct: 0, vocalBandEnergyDbfs: null, vocalMedianF0Hz: null, vocalF0RangeHz: null,
    vocalActivityIntervals: [],
    inferredSections: durationSeconds > 0 ? [{ index: 1, label: "Section 1", startSeconds: 0, endSeconds: durationSeconds, provisional: true }] : [],
    detectedTransitions: [], analysisWindowCount: 0, activeWindowCount: 0,
    analysisReason: reason, labelBasis: "No reliable windowed signal was available; no section names are asserted.",
    limitations: ["Signal-derived vocal-band activity is not proof of human vocals or a separated vocal stem."],
  });
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000 || samples.length < FFT_SIZE) {
    const duration = Number.isFinite(sampleRate) && sampleRate > 0 ? samples.length / sampleRate : 0;
    return empty(duration, "Insufficient PCM duration or sample rate for windowed vocal-band analysis.");
  }
  const prepared = monoPcm(samples, sampleRate, channels);
  const mono = prepared.samples, rate = prepared.sampleRate;
  const durationSeconds = mono.length / rate;
  if (mono.length < FFT_SIZE) return empty(durationSeconds, "Insufficient PCM after channel downmixing.");
  const windows: AnalysisWindow[] = [];
  let previousMagnitudes: number[] | null = null;
  const midPowers: number[] = [];
  const pitchStarts: number[] = [];
  for (let start = 0; start + FFT_SIZE <= mono.length; start += HOP_SIZE) {
    const result = analyzeWindow(mono, start, rate, previousMagnitudes);
    windows.push(result.window);
    previousMagnitudes = result.magnitudes;
    if (result.window.vocalActivity) {
      midPowers.push(Math.pow(10, result.midRmsDbfs / 20) ** 2);
      pitchStarts.push(start);
    }
  }
  const intervals = detectVocalActivityIntervals(windows, durationSeconds);
  const activeWindowCount = pitchStarts.length;
  const vocalPresencePct = windows.length ? Number((activeWindowCount / windows.length * 100).toFixed(1)) : 0;
  const midRms = midPowers.length ? Math.sqrt(midPowers.reduce((sum, value) => sum + value, 0) / midPowers.length) : null;
  const vocalBandEnergyDbfs = midRms === null ? null : Number((20 * Math.log10(Math.max(EPSILON, midRms))).toFixed(1));
  const selectedPitchStarts = pitchStarts.length <= MAX_PITCH_FRAMES
    ? pitchStarts
    : Array.from({ length: MAX_PITCH_FRAMES }, (_, index) =>
      pitchStarts[Math.floor(index * (pitchStarts.length - 1) / (MAX_PITCH_FRAMES - 1))]!
    );
  const pitches = selectedPitchStarts.map(start => frameF0(mono, start, rate)).filter((value): value is number => value !== null);
  const vocalMedianF0Hz = percentile(pitches, 0.5);
  const p10 = percentile(pitches, 0.1), p90 = percentile(pitches, 0.9);
  const f0Range = p10 !== null && p90 !== null ? { p10: Number(p10.toFixed(1)), p90: Number(p90.toFixed(1)) } : null;
  const arrangement = segmentArrangement(windows, durationSeconds);
  const activityDetected = activeWindowCount > 0;
  return {
    schemaVersion: "1.0.0", provenance: "SIGNAL_DERIVED_FROM_UPLOADED_MASTER",
    method: "WINDOWED_FFT_MID_BAND_SALIENCE_AND_AUTOCORRELATION",
    analysisStatus: "MEASURED_SIGNAL",
    vocalActivityStatus: activityDetected ? "SIGNAL_ACTIVITY_DETECTED" : "LOW_VOCAL_ACTIVITY",
    vocalPresencePct, vocalBandEnergyDbfs,
    vocalMedianF0Hz: vocalMedianF0Hz === null ? null : Number(vocalMedianF0Hz.toFixed(1)),
    vocalF0RangeHz: f0Range,
    vocalActivityIntervals: intervals,
    inferredSections: arrangement.sections,
    detectedTransitions: arrangement.transitions,
    analysisWindowCount: windows.length, activeWindowCount,
    analysisReason: activityDetected
      ? "Percentage counts windows exceeding provisional 250–3500 Hz band-salience and spectral-harmonicity thresholds; it is not a calibrated probability of human vocals."
      : "No windows crossed the provisional 250–3500 Hz salience and harmonicity thresholds; vocal-band activity is low or undetermined.",
    labelBasis: "Section boundaries use windowed spectral-flux novelty, RMS level changes, chroma movement and vocal-band activity changes. Labels use track position and repeated-section similarity; all labels are provisional.",
    limitations: [
      "Vocal-band activity and 70–500 Hz F0 candidates are inferred from the mixed uploaded master; this is not proof of human vocals, and instruments can produce similar energy and periodicity.",
      "No source separation or human-voice classifier is used; singing versus rap, lead versus backing, singer count, lyrics and delivery quality are not determined.",
      "Arrangement labels and transition triggers are deterministic provisional hypotheses and require human listening confirmation.",
    ],
  };
}
