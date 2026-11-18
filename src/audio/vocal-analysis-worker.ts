import { parentPort, workerData } from "node:worker_threads";
import { separateVocalsFromPcm } from "./vocal-separation.js";

const samples = workerData.samples instanceof Float32Array
  ? workerData.samples
  : new Float32Array(workerData.samples);
const result = await separateVocalsFromPcm(samples, workerData.sampleRate, workerData.channels);
parentPort?.postMessage(result);
