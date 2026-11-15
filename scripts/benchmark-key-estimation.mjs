import { estimateKey } from "../dist/audio/key-estimation.js";

const sampleRate = 44100;
const frameCount = 3_000_000;
const frequencies = [261.6256, 329.6276, 391.9954];
const samples = new Float32Array(frameCount);
for (let index = 0; index < frameCount; index++) {
  let value = 0;
  for (const frequency of frequencies) value += Math.sin(2 * Math.PI * frequency * index / sampleRate);
  samples[index] = value / frequencies.length;
}
const started = performance.now();
const result = estimateKey(samples, sampleRate);
const elapsedMs = performance.now() - started;
console.log("[key-estimator:synthetic-benchmark]", JSON.stringify({
  sampleRate,
  sampleCount: frameCount,
  analysisWindows: result.analysisWindows,
  operationCount: result.operationCount,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  key: result.key,
  mode: result.mode,
  confidence: result.confidence,
  method: result.method,
  realWorldAccuracyClaim: false,
}));
if (result.operationCount > 500_000) process.exitCode = 1;
