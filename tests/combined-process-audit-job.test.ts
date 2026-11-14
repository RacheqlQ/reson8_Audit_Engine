import { describe, expect, it } from "vitest";
import { processAuditJob } from "../src/jobs/process-audit-job.js";
import type { CatalogMetadata } from "../src/providers/dsp/catalog.js";
import type { AuditRecognition } from "../src/providers/audd/normalize.js";

const assessment = {} as import("../src/providers/groq/client.js").ArAssessment;
const metadata = {
  platform: "spotify", sourceUrl: "https://open.spotify.com/track/abc",
  canonicalUrl: "https://open.spotify.com/track/abc", catalogId: "abc",
  artist: "Master Artist", title: "Master Song", album: "Album",
  releaseDate: null, isrc: "US-ABC-12-34567", upc: null,
  catalogPopularity: 42, catalogPopularityScale: "0_100", label: "Label",
  genre: "Alt R&B", artworkUrl: null, previewUrl: "https://example.com/preview.mp3",
  externalIds: { spotify: "abc" }, raw: {}, evidenceStatus: "recognized",
  sonicProfile: null,
} as CatalogMetadata;

describe("combined master and DSP processing", () => {
  it("merges catalog identity and master-measured Sonic DNA into one sample/full report pair", async () => {
    const events: string[] = [];
    let assessmentInput: any;
    const recognition: AuditRecognition = { matched: true, artist: "Master Artist", title: "Master Song", isrc: "US-ABC-12-34567" };

    const result = await processAuditJob("combined-1", {
      getJob: async () => ({
        id: "combined-1", ownerId: null, sourceAudioPath: "anonymous/combined-1/master.wav",
        mimeType: "audio/wav", sourceType: "combined", catalogUrl: metadata.sourceUrl,
        status: "processing", claimToken: "claim-1", leaseExpiresAt: "2099-01-01T00:00:00Z", workerId: "test",
      }),
      markProcessing: async () => { events.push("processing"); },
      collectCatalogMetadata: async () => { events.push("catalog"); return metadata; },
      saveCatalogMetadata: async () => { events.push("catalog-saved"); },
      recognizeUrl: async () => ({ matched: false }),
      downloadMaster: async () => { events.push("master-downloaded"); return new Uint8Array([1,2,3]); },
      createRecognitionSample: async () => new Uint8Array([4,5]),
      recognize: async () => recognition,
      saveRecognition: async () => { events.push("recognition-saved"); },
      saveEvidence: async (_id, _token, _recognition, reconciliation, savedMetadata) => {
        events.push("evidence-saved");
        expect(savedMetadata?.platform).toBe("spotify");
        expect(reconciliation.identity.isrc).toBe("USABC1234567");
      },
      decode: async () => ({ samples: new Float32Array([0,0,0.1,0.1,-0.1,-0.1,0,0]), sampleRate: 44100, channels: 2 }),
      saveSonicDna: async (_id, _token, dna) => { events.push("dna-saved"); expect(dna.sampleRate).toBe(44100); },
      generateAssessment: async (input) => {
        events.push("assessment");
        assessmentInput = input;
        return assessment;
      },
      saveAssessment: async () => { events.push("assessment-saved"); },
      generateReport: async (input, tier) => {
        events.push("generated-"+tier);
        expect(input.evidence).toMatchObject({ sourceCombination: "master_and_dsp", artist: "Master Artist", title: "Master Song" });
        expect(input.sonicDna).toMatchObject({ provenance: "uploaded_audio_master", evidenceClass: "OBSERVED" });
        return new Uint8Array([37,80,68,70,45]);
      },
      saveReport: async (_id, _token, tier, _pdf, reportInput) => { events.push("saved-"+tier); if(tier==="full") expect(reportInput?.evidence).toMatchObject({ sourceCombination: "master_and_dsp" }); },
      markCompleted: async () => { events.push("completed"); },
      markFailed: async (_id, _token, message) => { throw new Error(message); },
    });

    expect(result.status).toBe("completed");
    expect(assessmentInput.evidence).toMatchObject({ sourceCombination: "master_and_dsp", platform: "spotify" });
    expect(assessmentInput.sonicDna).toMatchObject({ provenance: "uploaded_audio_master" });
    expect(events).toContain("catalog-saved");
    expect(events).toContain("master-downloaded");
    expect(events).toContain("dna-saved");
    expect(events).toContain("saved-sample");
    expect(events).toContain("saved-full");
    expect(events.at(-1)).toBe("completed");
  });
});
