import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataEngine } from "../src/metadata/MetadataEngine.js";
import { processAuditJob } from "../src/jobs/process-audit-job.js";

const originalAuddApi = process.env.AUDD_API;
afterEach(() => {
  if (originalAuddApi === undefined) delete process.env.AUDD_API;
  else process.env.AUDD_API = originalAuddApi;
});

describe("PR #39 field-level provenance", () => {
  it("attributes filename and ID3 values to the source that supplied each field", () => {
    const identity = MetadataEngine.normalize({
      id3: { album: "ID3 Album" },
      filename: "Filename Artist - Filename Title.mp3",
    });
    expect(identity).toMatchObject({
      title: "Filename Title",
      artist: "Filename Artist",
      album: "ID3 Album",
      fieldProvenance: {
        title: "filename", artist: "filename", album: "id3",
        isrc: null, upc: null, label: null, releaseDate: null,
      },
    });
  });

  it("attributes mixed-provider values independently and leaves missing fields unattributed", () => {
    const identity = MetadataEngine.normalize({
      spotify: { title: "Spotify Title" },
      id3: { artist: "ID3 Artist", album: "ID3 Album" },
      filename: "Filename Artist - Filename Title.mp3",
    });
    expect(identity).toMatchObject({
      title: "Spotify Title", artist: "ID3 Artist", album: "ID3 Album",
      fieldProvenance: {
        title: "spotify", artist: "id3", album: "id3",
        isrc: null, upc: null, label: null, releaseDate: null,
      },
    });
  });
});

describe("PR #39 AudD attempt provenance", () => {
  it("does not report AudD as checked when configured but no recognition call was attempted", async () => {
    process.env.AUDD_API = "configured-for-regression-test";
    let checkedSources: unknown;
    const result = await processAuditJob("catalog-no-preview", {
      getJob: async () => ({
        id: "catalog-no-preview", ownerId: null, sourceAudioPath: null, mimeType: null,
        sourceType: "dsp_link", catalogUrl: "https://tidal.com/browse/track/123",
        status: "processing", claimToken: "claim", leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test",
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async () => ({
        platform: "tidal", sourceUrl: "https://tidal.com/browse/track/123",
        canonicalUrl: "https://tidal.com/browse/track/123", catalogId: "123",
        artist: "Catalog Artist", title: "Catalog Title", album: null, releaseDate: null,
        isrc: null, upc: null, label: null, genre: null, catalogPopularity: null,
        catalogPopularityScale: "0_1", artworkUrl: null, previewUrl: null,
        externalIds: { tidal: "123" }, raw: {}, evidenceStatus: "recognized",
        sonicProfile: null,
      }),
      recognizeUrl: async () => { throw new Error("must not be called without preview URL"); },
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => { throw new Error("must not be called without master"); },
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      saveCatalogMetadata: async () => {},
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async ({ evidence }) => {
        checkedSources = evidence.metadataSourcesChecked;
        return {} as import("../src/providers/groq/client.js").ArAssessment;
      },
      saveAssessment: async () => {},
      generateReport: async () => new Uint8Array(Buffer.from("%PDF-1.7\\n")),
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_id, _claim, message) => { throw new Error(message); },
    });
    expect(result.status).toBe("completed");
    expect(checkedSources).toEqual(["tidal"]);
    expect(checkedSources).not.toContain("audd");
  });
});

describe("PR #39 issued access capability", () => {
  it("keeps the issued capability intact and passes manual keys only to their own request", async () => {
    const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
    expect(script).not.toContain("if(pastedKey)reportAccessToken=pastedKey");
    expect(script).toMatch(/downloadReport\\(["']full["'],\\s*pastedKey\\)/);
    expect(script).toMatch(/async function downloadReport\\(tier,\\s*accessToken\\)/);
    expect(script).toMatch(/"x-reson8-report-token":\\s*accessToken/);
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
  });
});
