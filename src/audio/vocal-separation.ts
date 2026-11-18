import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import separate, { type ModelSpec, type SeparateOptions, type Session } from "@audio/neural-separate";
import { load } from "@audio/neural-runtime";
import { analyzeVocalStem, unavailableVocalAnalysis, VOCAL_MODEL_SHA256, type VocalAnalysisResult } from "./vocal-analysis.js";

const MODEL_URL = "https://huggingface.co/MixDirective/open-unmix-umxhq-vocals-onnx/resolve/main/model.onnx";
const MODEL_BYTES = 35_623_512;
const MAX_MODEL_BYTES = 40 * 1024 * 1024;
let modelBytesPromise: Promise<Uint8Array> | null = null;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function modelCachePath(): string {
  const base = process.env.AUDIO_NEURAL_CACHE || path.join(homedir(), ".cache", "audiojs", "neural");
  return path.join(base, "reson8-open-unmix-umxhq-vocals.onnx");
}

async function readVerifiedModel(signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const file = modelCachePath();
  try {
    const cached = new Uint8Array(await readFile(file));
    if (cached.length === MODEL_BYTES && hash(cached) === VOCAL_MODEL_SHA256) return cached;
    await rm(file, { force: true });
  } catch {
    // A missing or unreadable cache entry is a cache miss; the downloaded artifact is verified below.
  }

  const response = await fetch(MODEL_URL, { signal, redirect: "follow" });
  if (!response.ok) throw new Error("VOCAL_MODEL_DOWNLOAD_FAILED: HTTP " + response.status);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_BYTES) {
    throw new Error("VOCAL_MODEL_SIZE_LIMIT: model response exceeds the 40 MiB safety limit");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_MODEL_BYTES || bytes.length !== MODEL_BYTES) {
    throw new Error("VOCAL_MODEL_SIZE_MISMATCH: expected " + MODEL_BYTES + " bytes, received " + bytes.length);
  }
  const actualHash = hash(bytes);
  if (actualHash !== VOCAL_MODEL_SHA256) {
    throw new Error("VOCAL_MODEL_HASH_MISMATCH: expected pinned SHA-256, received " + actualHash);
  }

  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".part";
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes;
}

function toStereo(samples: Float32Array, channelCount: number): Float32Array[] {
  const channels = Number.isInteger(channelCount) && channelCount > 0 ? channelCount : 1;
  const frames = Math.floor(samples.length / channels);
  if (channels === 1) return [samples.slice(0, frames)];
  if (channels === 2) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
      left[frame] = samples[frame * 2] ?? 0;
      right[frame] = samples[frame * 2 + 1] ?? 0;
    }
    return [left, right];
  }

  // Standard 5.1-style ordering: L, R, C, LFE, Ls, Rs. Unknown extra channels
  // are ignored rather than mixed into the vocal reference without a layout map.
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * channels;
    const center = (samples[offset + 2] ?? 0) * 0.70710678;
    const leftSurround = channels > 4 ? (samples[offset + 4] ?? 0) * 0.70710678 : 0;
    const rightSurround = channels > 5 ? (samples[offset + 5] ?? 0) * 0.70710678 : 0;
    left[frame] = ((samples[offset] ?? 0) + center + leftSurround) / 2.41421356;
    right[frame] = ((samples[offset + 1] ?? 0) + center + rightSurround) / 2.41421356;
  }
  return [left, right];
}

type SessionLoader = (model: ModelSpec, options: SeparateOptions) => Session | Promise<Session>;
type SeparateFunction = typeof separate;

export async function separateVocalsFromPcm(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  signal?: AbortSignal,
  overrides: { sessionLoader?: SessionLoader; separateImpl?: SeparateFunction } = {},
): Promise<VocalAnalysisResult> {
  signal?.throwIfAborted();
  if (!Number.isFinite(sampleRate) || sampleRate < 4000 || !Number.isInteger(channels) || channels < 1) {
    return unavailableVocalAnalysis("Decoded master format is not supported by the vocal separator.");
  }
  const mixChannels = toStereo(samples, channels);
  if (!mixChannels[0]?.length) return unavailableVocalAnalysis("The decoded master contains no audio frames.");

  const sessionLoader: SessionLoader = overrides.sessionLoader ?? (async (model: ModelSpec) => {
    if (model !== MODEL_URL) throw new Error("Unexpected vocal model URL");
    const bytes = modelBytesPromise ??= readVerifiedModel(signal);
    try {
      return await load(await bytes, {
        backend: "node",
        sessionOptions: { enableCpuMemArena: false, enableMemPattern: false },
      });
    } catch (error) {
      modelBytesPromise = null;
      throw error;
    }
  });

  const separator = overrides.separateImpl ?? separate;
  try {
    const separated = await separator(mixChannels, {
      sampleRate,
      targetRate: 44100,
      model: { vocals: MODEL_URL },
      modelType: "openunmix",
      targets: ["vocals"],
      // Keep CPU memory bounded on Render. The raw model estimate is sufficient
      // for conservative vocal activity analysis; full Wiener refinement is costlier.
      wiener: 0,
      chunk: 20,
      overlap: 2,
      session: sessionLoader,
    });
    signal?.throwIfAborted();
    const vocalStem = separated.stems.vocals;
    if (!vocalStem?.length) return unavailableVocalAnalysis("The vocal separation model returned no vocal stem.");
    return analyzeVocalStem(vocalStem, mixChannels, separated.sampleRate);
  } catch (error) {
    if (signal?.aborted) throw error;
    const reason = error instanceof Error ? error.message : "Vocal separation failed.";
    return unavailableVocalAnalysis(reason.slice(0, 300));
  }
}
