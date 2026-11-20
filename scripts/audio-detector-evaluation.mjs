import fs from "node:fs";
import { estimateKey } from "../dist/audio/key-estimation.js";
import { estimateGoertzelKey, estimateLowFrequencyEnvelopeTempo } from "../dist/audio/independent-estimators.js";
import { estimateTempo } from "../dist/audio/sonic-dna.js";

const sampleRate = 8_000;
const durationSeconds = 8;

function pulseTrain(bpm) {
  const samples = new Float32Array(sampleRate * durationSeconds);
  const period = Math.round(sampleRate * 60 / bpm);
  for (let onset = 0; onset < samples.length; onset += period) {
    for (let offset = 0; offset < Math.min(240, samples.length - onset); offset++) {
      const envelope = Math.exp(-offset / 42);
      samples[onset + offset] += 0.8 * envelope * Math.sin(2 * Math.PI * 1_200 * offset / sampleRate);
      samples[onset + offset] += 0.25 * envelope * Math.sin(2 * Math.PI * 82 * offset / sampleRate);
    }
  }
  return samples;
}

function aMinorChord() {
  const samples = new Float32Array(sampleRate * durationSeconds);
  const frequencies = [220, 261.6256, 329.6276, 440];
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    samples[index] = frequencies.reduce((sum, frequency) =>
      sum + Math.sin(2 * Math.PI * frequency * time), 0) / frequencies.length;
  }
  return samples;
}

const tempoFixture = pulseTrain(120);
const keyFixture = aMinorChord();
const silence = new Float32Array(sampleRate * durationSeconds);
const primaryTempo = estimateTempo(tempoFixture, sampleRate);
const independentTempo = estimateLowFrequencyEnvelopeTempo(tempoFixture, sampleRate);
const primaryKey = estimateKey(keyFixture, sampleRate);
const independentKey = estimateGoertzelKey(keyFixture, sampleRate);
const silenceTempo = estimateTempo(silence, sampleRate);
const silenceKey = estimateKey(silence, sampleRate);
const silenceIndependentKey = estimateGoertzelKey(silence, sampleRate);

const result = {
  schemaVersion: 1,
  evaluationType: "synthetic-fixture-diagnostics",
  generatedAt: new Date().toISOString(),
  realWorldAccuracyClaim: false,
  thirdPartyDetectorsInstalled: false,
  fixtures: {
    tempo: {
      expectedBpm: 120,
      primary: {
        bpm: primaryTempo.bpm,
        candidateBpm: primaryTempo.topCandidateBpm,
        confidence: primaryTempo.confidence,
        abstentionReason: primaryTempo.abstentionReason,
        method: primaryTempo.method,
      },
      independent: {
        bpm: independentTempo.bpm,
        score: independentTempo.score,
        limitation: independentTempo.limitation,
        method: independentTempo.method,
      },
      absoluteErrorBpm: primaryTempo.bpm === null ? null : Math.abs(primaryTempo.bpm - 120),
    },
    key: {
      expected: "A minor",
      primary: {
        key: primaryKey.key,
        mode: primaryKey.mode,
        confidence: primaryKey.confidence,
        segmentAgreement: primaryKey.segmentAgreement,
        limitation: primaryKey.limitation,
        method: primaryKey.method,
      },
      independent: {
        key: independentKey.key,
        mode: independentKey.mode,
        score: independentKey.score,
        margin: independentKey.margin,
        limitation: independentKey.limitation,
        method: independentKey.method,
      },
      primaryMatch: primaryKey.key === "A" && primaryKey.mode === "minor",
      independentMatch: independentKey.key === "A" && independentKey.mode === "minor",
    },
    silence: {
      primaryTempoAbstained: silenceTempo.bpm === null,
      primaryKeyAbstained: silenceKey.key === null,
      independentKeyAbstained: silenceIndependentKey.key === null,
    },
  },
  interpretation: "Synthetic fixtures verify execution, diagnostic output, and abstention only. They do not establish real-world detector accuracy or model superiority.",
};

fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/audio-detector-evaluation.json", JSON.stringify(result, null, 2) + "\n");
console.log("[audio-detector-evaluation]", JSON.stringify(result));
