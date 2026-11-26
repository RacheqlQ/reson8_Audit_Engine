import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// URL.pathname yields "/C:/..." on Windows, which Node cannot resolve as a
// module path. fileURLToPath produces the platform-native absolute path.
const scriptPath = fileURLToPath(new URL("../scripts/diagnostics-to-fixture.mjs", import.meta.url));

describe("audit diagnostics fixture converter", () => {
  it("exports only bounded tempo/key features and omits unrelated event payload data", () => {
    const input = {
      payload: {
        diagnostics: {
          version: 1,
          tempo: {
            method: "high_frequency_transient_autocorrelation",
            candidateScores: [{ bpm: 100, score: 0.91 }],
            onsetEnvelope: [0, 0.5, 1],
            beatTimesSeconds: [0.2, 0.8, 1.4],
            downbeatCandidateTimesSeconds: [0.2],
            beatGridStatus: "tentative",
            downbeatGridAssumption: "four-beat grouping for diagnostics only",
          },
          key: {
            method: "fft_harmonic_chroma_ensemble",
            tuningCents: 7.5,
            segmentAgreement: 0.9,
            segmentChroma: [{
              startSeconds: 0,
              endSeconds: 4,
              chroma: Array(12).fill(1 / 12),
              winningKey: "C",
              winningMode: "major",
              winningScore: 0.8,
            }],
          },
        },
        originalAudioBytes: "must-not-be-copied",
        accessToken: "must-not-be-copied",
      },
    };
    const output = execFileSync(process.execPath, [scriptPath], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });

    expect(output).toContain('"bpm": 100');
    expect(output).toContain('"tuningCents": 7.5');
    expect(output).toContain('"chroma"');
    expect(output).not.toContain("must-not-be-copied");
    expect(output).not.toContain("originalAudioBytes");
    expect(output).not.toContain("accessToken");
  });

  it("rejects payloads that do not contain an audio diagnostics object", () => {
    expect(() => execFileSync(process.execPath, [scriptPath], {
      input: JSON.stringify({ payload: { originalAudioBytes: "not-a-diagnostic" } }),
      encoding: "utf8",
    })).toThrow();
  });
});
