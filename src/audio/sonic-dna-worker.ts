import { parentPort, workerData } from "node:worker_threads";
import { analyzePcm } from "./sonic-dna.js";

const samples = workerData.samples instanceof Float32Array
  ? workerData.samples
  : new Float32Array(workerData.samples);
const result = analyzePcm(samples, workerData.sampleRate, workerData.channels);
parentPort?.postMessage(result);
