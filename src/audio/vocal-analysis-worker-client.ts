import { Worker } from "node:worker_threads";
import { separateVocalsFromPcm } from "./vocal-separation.js";
import type { VocalAnalysisResult } from "./vocal-analysis.js";

export const VOCAL_ANALYSIS_TIMEOUT_MS = 150_000;

export interface PcmTransferPayload {
  samples: Float32Array;
  transferList: ArrayBuffer[];
}

/** Reuse an exclusively-owned PCM allocation; compact only views that expose unrelated backing data. */
export function preparePcmTransfer(samples: Float32Array, options: { allowLeadingBytes?: number } = {}): PcmTransferPayload {
  const backing = samples.buffer;
  const allowLeadingBytes = options.allowLeadingBytes ?? 0;
  if (
    backing instanceof ArrayBuffer
    && samples.byteOffset === 0
    && samples.byteLength === backing.byteLength
  ) {
    return { samples, transferList: [backing] };
  }
  // The FFmpeg WAV decoder owns this dedicated buffer. Its PCM view begins
  // after the small RIFF header and extends to the end of the allocation.
  // Transfer the backing allocation rather than cloning the entire PCM.
  if (
    backing instanceof ArrayBuffer
    && allowLeadingBytes > 0
    && samples.byteOffset > 0
    && samples.byteOffset <= allowLeadingBytes
    && samples.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
    && samples.byteOffset + samples.byteLength === backing.byteLength
  ) {
    return { samples, transferList: [backing] };
  }
  const compact = new Float32Array(samples);
  return { samples: compact, transferList: [compact.buffer as ArrayBuffer] };
}

export function analyzeVocalsWithTimeout(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  timeoutMs = VOCAL_ANALYSIS_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<VocalAnalysisResult> {
  if (import.meta.url.endsWith(".ts")) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return separateVocalsFromPcm(samples, sampleRate, channels, signal);
  }
  const payload = preparePcmTransfer(samples, { allowLeadingBytes: 64 });
  const worker = new Worker(new URL("./vocal-analysis-worker.js", import.meta.url), {
    workerData: { samples: payload.samples, sampleRate, channels },
    transferList: payload.transferList,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: VocalAnalysisResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        void worker.terminate();
        reject(error);
      } else {
        resolve(result as VocalAnalysisResult);
      }
    };
    const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_STAGE_ABORTED"));
    const timer = setTimeout(() => finish(new Error("AUDIT_STAGE_TIMEOUT:vocal_analysis")), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (result: VocalAnalysisResult) => finish(undefined, result));
    worker.once("error", (error) => finish(new Error("Vocal analysis worker failed: " + error.message)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error("Vocal analysis worker exited before completing analysis"));
    });
  });
}
