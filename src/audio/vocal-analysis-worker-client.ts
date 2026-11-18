import { Worker } from "node:worker_threads";
import { separateVocalsFromPcm } from "./vocal-separation.js";
import type { VocalAnalysisResult } from "./vocal-analysis.js";

export const VOCAL_ANALYSIS_TIMEOUT_MS = 150_000;

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
  const transferable = new Float32Array(samples);
  const worker = new Worker(new URL("./vocal-analysis-worker.js", import.meta.url), {
    workerData: { samples: transferable, sampleRate, channels },
    transferList: [transferable.buffer],
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
