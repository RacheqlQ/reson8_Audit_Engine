import { Worker } from "node:worker_threads";
import { analyzePcm, preparePcmForWorker, type SonicDnaFeatures } from "./sonic-dna.js";

export function analyzePcmWithTimeout(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  timeoutMs = 90_000,
  signal?: AbortSignal,
): Promise<SonicDnaFeatures> {
  if (import.meta.url.endsWith(".ts")) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return Promise.resolve().then(() => analyzePcm(samples, sampleRate, channels));
  }
  const prepared = preparePcmForWorker(samples, sampleRate, channels);
  const transferable = prepared.samples;
  const worker = new Worker(new URL("./sonic-dna-worker.js", import.meta.url), {
    workerData: { samples: transferable, sampleRate: prepared.sampleRate, channels: prepared.channels },
    transferList: [transferable.buffer as ArrayBuffer],
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: SonicDnaFeatures) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        void worker.terminate();
        reject(error);
      } else {
        resolve(result as SonicDnaFeatures);
      }
    };
    const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_STAGE_ABORTED"));
    const timer = setTimeout(() => finish(new Error("AUDIT_STAGE_TIMEOUT:sonic_dna")), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (result: SonicDnaFeatures) => finish(undefined, result));
    worker.once("error", (error) => finish(new Error("Sonic DNA worker failed: " + error.message)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error("Sonic DNA worker exited before completing analysis"));
    });
  });
}
