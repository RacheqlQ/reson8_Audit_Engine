import { readFileSync } from "node:fs";

const input = readFileSync(0, "utf8").trim();
if (!input) throw new Error("Provide one audit_events JSON payload on stdin.");
const root = JSON.parse(input);
const payload = root?.payload && typeof root.payload === "object" ? root.payload : root;
const source = payload?.diagnostics;
if (!source || typeof source !== "object") throw new Error("Input has no diagnostics object.");

const finiteArray = (value, limit) => Array.isArray(value)
  ? value.filter((item) => typeof item === "number" && Number.isFinite(item)).slice(0, limit)
  : [];
const tempoSource = source.tempo && typeof source.tempo === "object" ? source.tempo : {};
const keySource = source.key && typeof source.key === "object" ? source.key : {};
const candidateScores = Array.isArray(tempoSource.candidateScores)
  ? tempoSource.candidateScores.slice(0, 8).flatMap((item) =>
      item && Number.isFinite(item.bpm) && Number.isFinite(item.score)
        ? [{ bpm: item.bpm, score: item.score }]
        : [],
    )
  : [];
const segmentChroma = Array.isArray(keySource.segmentChroma)
  ? keySource.segmentChroma.slice(0, 12).flatMap((item) => {
      if (!item || !Array.isArray(item.chroma) || item.chroma.length !== 12) return [];
      const chroma = item.chroma.filter((value) => typeof value === "number" && Number.isFinite(value)).slice(0, 12);
      if (chroma.length !== 12) return [];
      return [{
        startSeconds: Number.isFinite(item.startSeconds) ? item.startSeconds : null,
        endSeconds: Number.isFinite(item.endSeconds) ? item.endSeconds : null,
        chroma,
        winningKey: typeof item.winningKey === "string" ? item.winningKey : null,
        winningMode: typeof item.winningMode === "string" ? item.winningMode : null,
        winningScore: Number.isFinite(item.winningScore) ? item.winningScore : null,
      }];
    })
  : [];
const fixture = {
  version: Number.isInteger(source.version) ? source.version : 1,
  tempo: {
    method: typeof tempoSource.method === "string" ? tempoSource.method : null,
    candidateScores,
    onsetEnvelope: finiteArray(tempoSource.onsetEnvelope, 128),
    beatTimesSeconds: finiteArray(tempoSource.beatTimesSeconds, 512),
    downbeatCandidateTimesSeconds: finiteArray(tempoSource.downbeatCandidateTimesSeconds, 128),
    beatGridStatus: tempoSource.beatGridStatus === "tentative" ? "tentative" : "not_determined",
    downbeatGridAssumption: typeof tempoSource.downbeatGridAssumption === "string" ? tempoSource.downbeatGridAssumption : null,
  },
  key: {
    method: typeof keySource.method === "string" ? keySource.method : null,
    tuningCents: Number.isFinite(keySource.tuningCents) ? keySource.tuningCents : null,
    segmentAgreement: Number.isFinite(keySource.segmentAgreement) ? keySource.segmentAgreement : null,
    segmentChroma,
  },
};
process.stdout.write("export const diagnosticFixture = " + JSON.stringify(fixture, null, 2) + " as const;\n");
