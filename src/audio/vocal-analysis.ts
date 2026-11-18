export interface VocalActivitySegment {
  startSeconds: number;
  endSeconds: number;
  meanLevelDbfs: number;
  peakLevelDbfs: number;
}

export interface VocalPitchPoint {
  timeSeconds: number;
  fundamentalHz: number;
}

export interface VocalAnalysisResult {
  status: "analyzed" | "insufficient_evidence" | "unavailable";
  method: "open_unmix_umxhq_vocal_stem" | "not_run";
  model: {
    name: "Open-Unmix UMX-HQ vocals";
    artifactSha256: string;
  };
  voicePresence: "likely_present" | "not_detected" | "uncertain";
  vocalStemRmsDbfs: number | null;
  vocalEnergyShare: number | null;
  vocalActivityRatio: number | null;
  activeDurationSeconds: number;
  activitySegments: VocalActivitySegment[];
  pitch: {
    medianHz: number | null;
    lowerHz: number | null;
    upperHz: number | null;
    voicedFrameRatio: number | null;
    track: VocalPitchPoint[];
  };
  delivery: "not_classified";
  layering: "not_classified";
  lyrics: "not_requested";
  limitations: string[];
  reason?: string;
}

export const VOCAL_MODEL_SHA256 = "f27742bb52b24cb039614dc76d0764e279df3eb2a9d6daa82c6daee3369ec747";
const EPSILON = 1e-12;
const FRAME_SECONDS = 0.1;
const PITCH_FRAME_SECONDS = 0.04;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 1000;
const MAX_PITCH_FRAMES = 512;

function rms(values: Float32Array): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower);
}

function mono(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  const length = Math.min(...channels.map((channel) => channel.length));
  const output = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index++) output[index] += (channel[index] ?? 0) / channels.length;
  }
  return output;
}

function estimatePitch(samples: Float32Array, sampleRate: number): {
  medianHz: number | null;
  lowerHz: number | null;
  upperHz: number | null;
  voicedFrameRatio: number | null;
  track: VocalPitchPoint[];
} {
  const frameLength = Math.max(256, Math.round(sampleRate * PITCH_FRAME_SECONDS));
  const hop = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const available = samples.length < frameLength ? 0 : Math.floor((samples.length - frameLength) / hop) + 1;
  if (!available) return { medianHz: null, lowerHz: null, upperHz: null, voicedFrameRatio: null, track: [] };

  const sampled = Math.min(MAX_PITCH_FRAMES, available);
  const lagMin = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
  const lagMax = Math.min(frameLength - 2, Math.ceil(sampleRate / MIN_PITCH_HZ));
  const frequencies: number[] = [];
  const track: VocalPitchPoint[] = [];
  let energyFrames = 0;

  for (let frame = 0; frame < sampled; frame++) {
    const frameIndex = sampled === 1 ? 0 : Math.floor(frame * (available - 1) / (sampled - 1));
    const start = frameIndex * hop;
    let mean = 0;
    for (let index = 0; index < frameLength; index++) mean += samples[start + index] ?? 0;
    mean /= frameLength;

    let energy = 0;
    for (let index = 0; index < frameLength; index++) {
      const centered = (samples[start + index] ?? 0) - mean;
      energy += centered * centered;
    }
    if (energy / frameLength < 1e-7) continue;
    energyFrames++;

    const correlations = new Float32Array(lagMax + 1);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let cross = 0;
      let left = 0;
      let right = 0;
      for (let index = 0; index < frameLength - lag; index++) {
        const a = (samples[start + index] ?? 0) - mean;
        const b = (samples[start + index + lag] ?? 0) - mean;
        cross += a * b;
        left += a * a;
        right += b * b;
      }
      correlations[lag] = cross / Math.sqrt(Math.max(EPSILON, left * right));
    }
    let selectedLag = 0;
    for (let lag = lagMin + 1; lag < lagMax; lag++) {
      const correlation = correlations[lag] ?? 0;
      if (
        correlation >= 0.6
        && correlation >= (correlations[lag - 1] ?? 0)
        && correlation >= (correlations[lag + 1] ?? 0)
      ) {
        selectedLag = lag;
        break;
      }
    }
    if (selectedLag > 0) {
      const fundamentalHz = sampleRate / selectedLag;
      frequencies.push(fundamentalHz);
      track.push({ timeSeconds: Number((start / sampleRate).toFixed(3)), fundamentalHz: Number(fundamentalHz.toFixed(1)) });
    }
  }

  if (!frequencies.length) return { medianHz: null, lowerHz: null, upperHz: null, voicedFrameRatio: energyFrames ? 0 : null, track: [] };
  return {
    medianHz: Number(percentile(frequencies, 0.5).toFixed(1)),
    lowerHz: Number(percentile(frequencies, 0.1).toFixed(1)),
    upperHz: Number(percentile(frequencies, 0.9).toFixed(1)),
    voicedFrameRatio: energyFrames ? Number((frequencies.length / energyFrames).toFixed(4)) : null,
    track: track.length <= 128 ? track : track.filter((_point, index) => index % Math.ceil(track.length / 128) === 0).slice(0, 128),
  };
}

export function unavailableVocalAnalysis(reason: string, status: "unavailable" | "insufficient_evidence" = "unavailable", method: "not_run" | "open_unmix_umxhq_vocal_stem" = "not_run"): VocalAnalysisResult {
  return {
    status,
    method,
    model: { name: "Open-Unmix UMX-HQ vocals", artifactSha256: VOCAL_MODEL_SHA256 },
    voicePresence: "uncertain",
    vocalStemRmsDbfs: null,
    vocalEnergyShare: null,
    vocalActivityRatio: null,
    activeDurationSeconds: 0,
    activitySegments: [],
    pitch: { medianHz: null, lowerHz: null, upperHz: null, voicedFrameRatio: null, track: [] },
    delivery: "not_classified",
    layering: "not_classified",
    lyrics: "not_requested",
    limitations: ["No vocal conclusion is available because the separation model did not complete."],
    reason,
  };
}

export function analyzeVocalStem(
  vocalChannels: Float32Array[],
  mixChannels: Float32Array[],
  sampleRate: number,
): VocalAnalysisResult {
  const vocal = mono(vocalChannels);
  const mix = mono(mixChannels);
  const length = Math.min(vocal.length, mix.length);
  if (!Number.isFinite(sampleRate) || sampleRate < 4000 || length < sampleRate * 0.5) {
    return unavailableVocalAnalysis("At least half a second of decoded master and vocal-stem PCM at 4 kHz or higher is required.", "insufficient_evidence", "open_unmix_umxhq_vocal_stem");
  }

  let vocalEnergy = 0;
  let mixEnergy = 0;
  for (let index = 0; index < length; index++) {
    const v = vocal[index] ?? 0;
    const m = mix[index] ?? 0;
    vocalEnergy += v * v;
    mixEnergy += m * m;
  }
  const vocalRms = Math.sqrt(vocalEnergy / length);
  const mixRms = Math.sqrt(mixEnergy / length);
  const vocalEnergyShare = mixEnergy > EPSILON ? vocalEnergy / mixEnergy : 0;

  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frameCount = Math.ceil(length / frameLength);
  const frameLevels: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * frameLength;
    const end = Math.min(length, start + frameLength);
    let energy = 0;
    for (let index = start; index < end; index++) energy += (vocal[index] ?? 0) ** 2;
    frameLevels.push(Math.sqrt(energy / Math.max(1, end - start)));
  }

  const threshold = Math.max(percentile(frameLevels, 0.9) * 0.08, percentile(frameLevels, 0.2) * 2.5, 1e-5);
  const active = frameLevels.map((level) => level >= threshold && level >= 1e-5);
  const activeCount = active.filter(Boolean).length;
  const vocalActivityRatio = activeCount / Math.max(1, frameCount);
  const segments: VocalActivitySegment[] = [];
  let cursor = 0;
  while (cursor < active.length) {
    if (!active[cursor]) { cursor++; continue; }
    const first = cursor;
    let last = cursor;
    cursor++;
    while (cursor < active.length) {
      if (active[cursor]) { last = cursor; cursor++; continue; }
      let gap = 0;
      while (cursor + gap < active.length && !active[cursor + gap] && gap < 2) gap++;
      if (gap <= 1 && cursor + gap < active.length && active[cursor + gap]) {
        cursor += gap;
        last = cursor;
        cursor++;
      } else break;
    }
    const startSeconds = first * FRAME_SECONDS;
    const endSeconds = Math.min(length / sampleRate, (last + 1) * FRAME_SECONDS);
    if (endSeconds - startSeconds >= 0.2) {
      const levels = frameLevels.slice(first, last + 1);
      const segmentMean = rms(Float32Array.from(levels));
      const segmentPeak = Math.max(...levels);
      segments.push({
        startSeconds: Number(startSeconds.toFixed(2)),
        endSeconds: Number(endSeconds.toFixed(2)),
        meanLevelDbfs: Number((20 * Math.log10(Math.max(EPSILON, segmentMean))).toFixed(1)),
        peakLevelDbfs: Number((20 * Math.log10(Math.max(EPSILON, segmentPeak))).toFixed(1)),
      });
    }
  }

  const pitch = estimatePitch(vocal, sampleRate);
  const energyShare = Math.max(0, Math.min(1, vocalEnergyShare));
  const voicePresence = energyShare >= 0.025 && vocalActivityRatio >= 0.08 && (pitch.voicedFrameRatio ?? 0) >= 0.15
    ? "likely_present" as const
    : energyShare < 0.003 || vocalActivityRatio < 0.015
      ? "not_detected" as const
      : "uncertain" as const;

  return {
    status: "analyzed",
    method: "open_unmix_umxhq_vocal_stem",
    model: { name: "Open-Unmix UMX-HQ vocals", artifactSha256: VOCAL_MODEL_SHA256 },
    voicePresence,
    vocalStemRmsDbfs: Number((20 * Math.log10(Math.max(EPSILON, vocalRms))).toFixed(1)),
    vocalEnergyShare: Number(energyShare.toFixed(4)),
    vocalActivityRatio: Number(vocalActivityRatio.toFixed(4)),
    activeDurationSeconds: Number(Math.min(length / sampleRate, activeCount * FRAME_SECONDS).toFixed(2)),
    activitySegments: segments,
    pitch,
    delivery: "not_classified",
    layering: "not_classified",
    lyrics: "not_requested",
    limitations: [
      "Vocal presence is a conservative interpretation of a separated stem and energy/pitch evidence, not a calibrated probability.",
      "Source separation can leak harmonic instruments into the vocal stem or suppress difficult vocal material.",
      "Singing versus speech/rap, lead versus backing vocals, choir count and vocal effects are not independently classified.",
      "No lyrics or transcription were requested or generated.",
    ],
  };
}
