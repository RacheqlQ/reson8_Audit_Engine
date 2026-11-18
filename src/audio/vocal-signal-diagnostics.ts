export interface VocalSignalDiagnostics {
  status: "signal_diagnostics_only" | "insufficient_evidence";
  method: "autocorrelation_voiced_periodicity";
  voicePresence: "undetermined";
  sampledFrames: number;
  periodicFrames: number;
  periodicityActivityRatio: number | null;
  medianFundamentalHz: number | null;
  lowerFundamentalHz: number | null;
  upperFundamentalHz: number | null;
  limitations: string[];
}

const EPSILON = 1e-12;
const MIN_F0_HZ = 70;
const MAX_F0_HZ = 500;
const MAX_FRAMES = 512;

/**
 * Measures periodic, voice-range fundamental-frequency candidates in the
 * supplied mix. This is deliberately NOT a vocal detector: instruments,
 * bass harmonics, synths and other periodic sources can produce the same
 * evidence. Presence, speech/singing class, singer identity and vocal stems
 * remain undetermined until a validated source-separation/classification
 * model is run.
 */
export function analyzeVocalSignalDiagnostics(
  samples: Float32Array,
  sampleRate: number,
): VocalSignalDiagnostics {
  const empty = (reason: string): VocalSignalDiagnostics => ({
    status: "insufficient_evidence",
    method: "autocorrelation_voiced_periodicity",
    voicePresence: "undetermined",
    sampledFrames: 0,
    periodicFrames: 0,
    periodicityActivityRatio: null,
    medianFundamentalHz: null,
    lowerFundamentalHz: null,
    upperFundamentalHz: null,
    limitations: [reason],
  });

  if (!Number.isFinite(sampleRate) || sampleRate < 4000 || samples.length < sampleRate) {
    return empty("At least one second of PCM at 4 kHz or higher is required for periodicity diagnostics.");
  }

  const frameLength = Math.max(512, Math.round(sampleRate * 0.04));
  if (samples.length < frameLength) {
    return empty("The supplied PCM is too short for a stable voice-range periodicity window.");
  }
  const hop = Math.max(1, Math.floor(frameLength / 2));
  const availableFrames = Math.floor((samples.length - frameLength) / hop) + 1;
  const frameCount = Math.min(MAX_FRAMES, availableFrames);
  const lagMin = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));
  const lagMax = Math.min(frameLength - 2, Math.ceil(sampleRate / MIN_F0_HZ));
  const pitches: number[] = [];
  let sampledFrames = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const start = frameCount === 1
      ? 0
      : Math.floor(frameIndex * (availableFrames - 1) / (frameCount - 1)) * hop;
    let mean = 0;
    for (let i = 0; i < frameLength; i++) mean += samples[start + i] ?? 0;
    mean /= frameLength;

    let energy = 0;
    for (let i = 0; i < frameLength; i++) {
      const centered = (samples[start + i] ?? 0) - mean;
      energy += centered * centered;
    }
    if (energy / frameLength < 1e-7) continue;
    sampledFrames++;

    let bestLag = 0;
    let bestCorrelation = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let cross = 0;
      let left = 0;
      let right = 0;
      for (let i = 0; i < frameLength - lag; i++) {
        const a = (samples[start + i] ?? 0) - mean;
        const b = (samples[start + i + lag] ?? 0) - mean;
        cross += a * b;
        left += a * a;
        right += b * b;
      }
      const correlation = cross / Math.sqrt(Math.max(EPSILON, left * right));
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && bestCorrelation >= 0.6) pitches.push(sampleRate / bestLag);
  }

  if (sampledFrames === 0) return empty("No frames contained sufficient signal energy for periodicity diagnostics.");
  const sorted = [...pitches].sort((a, b) => a - b);
  const percentile = (p: number): number | null => {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };

  return {
    status: "signal_diagnostics_only",
    method: "autocorrelation_voiced_periodicity",
    voicePresence: "undetermined",
    sampledFrames,
    periodicFrames: pitches.length,
    periodicityActivityRatio: Number((pitches.length / sampledFrames).toFixed(4)),
    medianFundamentalHz: percentile(0.5),
    lowerFundamentalHz: percentile(0.1),
    upperFundamentalHz: percentile(0.9),
    limitations: [
      "Periodic energy in the 70–500 Hz range is not proof of human vocals; bass, synths and other instruments can produce similar contours.",
      "No source separation, speech/singing classification, singer count, lyric recognition or backing-vocal detection was performed.",
      "These values are diagnostic candidates, not calibrated vocal-presence probabilities or a validated singing pitch track.",
    ],
  };
}
