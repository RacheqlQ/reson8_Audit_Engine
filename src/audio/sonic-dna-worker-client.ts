import { Worker } from "node:worker_threads";
import type { SonicDnaFeatures } from "./sonic-dna.js";

export function analyzePcmWithTimeout(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  timeoutMs = 90_000,
): Promise<SonicDnaFeatures> {
  const transferable = new Float32Array(samples);
  const worker = new Worker(new URL("./sonic-dna-worker.js", import.meta.url), {
    workerData: { samples: transferable, sampleRate, channels },
    transferList: [transferable.buffer],
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: SonicDnaFeatures) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        void worker.terminate();
        reject(error);
      } else {
        resolve(result as SonicDnaFeatures);
      }
    };
    const timer = setTimeout(() => finish(new Error("AUDIT_STAGE_TIMEOUT:sonic_dna")), timeoutMs);
    timer.unref?.();
    worker.once("message", (result: SonicDnaFeatures) => finish(undefined, result));
    worker.once("error", (error) => finish(new Error("Sonic DNA worker failed: " + error.message)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error("Sonic DNA worker exited before completing analysis"));
    });
  });
}
