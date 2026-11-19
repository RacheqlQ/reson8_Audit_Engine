import { describe, expect, it } from "vitest";
import { processAuditJob } from "../src/jobs/process-audit-job.js";
import type { CatalogMetadata, DspPlatform } from "../src/providers/dsp/catalog.js";

const assessment = {} as import("../src/providers/groq/client.js").ArAssessment;
const claimToken = "11111111-1111-4111-8111-111111111111";
const links = [
  "https://open.spotify.com/track/spotify-1",
  "https://music.apple.com/us/album/song/12345?i=67890",
  "https://www.deezer.com/track/deezer-1",
  "https://tidal.com/browse/track/tidal-1",
  "https://music.youtube.com/watch?v=youtube-1",
];

function source(platform: DspPlatform, url: string): CatalogMetadata {
  return {
    platform, sourceUrl: url, canonicalUrl: url, catalogId: platform,
    artist: platform === "tidal" ? "Wrong Artist" : "Tems",
    title: "Free Mind", album: "For Broken Ears", releaseDate: "2020-09-25",
    isrc: "NGABC2000001", upc: null, catalogPopularity: null, catalogPopularityScale: null,
    label: null, genre: "Afrobeats", artworkUrl: null, previewUrl: null,
    externalIds: { [platform]: platform }, sonicProfile: null, raw: {},
    evidenceStatus: "recognized",
  };
}

describe("multi-DSP audit processing", () => {
  it("collects five platforms deterministically and keeps the one identity conflict visible to assessment and report", async () => {
    const collected: string[] = [];
    const saved: string[] = [];
    let assessmentEvidence: Record<string, unknown> | null = null;
    let assessmentCatalogMetadata: Record<string, unknown> | null = null;
    let reportEvidence: Record<string, unknown> | null = null;
    const result = await processAuditJob("multi-dsp-job", {
      getJob: async () => ({
        id: "multi-dsp-job", ownerId: null, sourceAudioPath: null, mimeType: null,
        sourceType: "dsp_link" as const, catalogUrl: links[0]!, catalogUrls: links,
        status: "processing" as const, claimToken, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "multi-dsp-test",
      }),
      markProcessing: async () => {},
      collectIsrcCatalogMetadata: async (isrc) => ({ isrc, metadata: [], outcomes: [{ provider: "musicbrainz", status: "partial", reason: "No fixture match; external lookup intentionally mocked." }] }),
      collectCatalogMetadata: async (url) => {
        collected.push(url);
        const platform = url.includes("spotify") ? "spotify"
          : url.includes("apple") ? "apple_music"
          : url.includes("deezer") ? "deezer"
          : url.includes("tidal") ? "tidal" : "youtube_music";
        return source(platform, url);
      },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async (_jobId, _claimToken, _recognition, reconciliation, _metadata, _signal, metadataSources) => {
        expect(metadataSources).toHaveLength(5);
        expect((metadataSources as CatalogMetadata[]).map((item) => item.platform)).toEqual(["spotify", "apple_music", "deezer", "tidal", "youtube_music"]);
        expect(reconciliation.status).toBe("conflict");
        expect(reconciliation.conflicts).toEqual([{ field: "artist", values: ["Tems", "Wrong Artist"] }]);
      },
      saveCatalogMetadata: async (_jobId, _claimToken, metadata) => { saved.push(metadata.platform); },
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async (input) => {
        assessmentEvidence = input.evidence;
        assessmentCatalogMetadata = input.catalogMetadata ?? null;
        return assessment;
      },
      saveAssessment: async () => {},
      generateReport: async (input) => {
        reportEvidence = input.evidence;
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_jobId, _claimToken, message) => { throw new Error(message); },
    });

    expect(result.status).toBe("completed");
    expect(collected).toEqual(links);
    expect(saved).toEqual(["spotify", "apple_music", "deezer", "tidal", "youtube_music"]);
    expect(assessmentEvidence).toMatchObject({
      artist: null,
      reconciliation: { status: "conflict", conflicts: [{ field: "artist", values: ["Wrong Artist", "Tems"] }] },
      metadataSourcesChecked: ["apple_music", "deezer", "tidal", "youtube_music"],

    });
    expect(assessmentEvidence?.catalogSources).toHaveLength(4);
    expect(assessmentCatalogMetadata?.artist).toBeNull();
    expect(assessmentCatalogMetadata?.identity).toMatchObject({ artist: null });
    expect(assessmentEvidence?.sourceProviders).not.toContain("spotify");
    expect(JSON.stringify(assessmentEvidence)).not.toContain("spotify-1");
    expect(reportEvidence).toMatchObject({
      artist: "Tems",
      reconciliation: { status: "conflict" },
    });
    expect(JSON.stringify(reportEvidence)).toContain("Wrong Artist");
  });

  it("persists a failed provider result while continuing with another DSP source", async () => {
    const failed: Array<{ platform: string; catalogId: string; error: string }> = [];
    const urls = [
      "https://open.spotify.com/track/spotify-fail",
      "https://tidal.com/browse/track/tidal-good",
    ];
    const result = await processAuditJob("provider-failure-job", {
      getJob: async () => ({
        id: "provider-failure-job", ownerId: null, sourceAudioPath: null, mimeType: null,
        sourceType: "dsp_link" as const, catalogUrl: urls[0]!, catalogUrls: urls,
        status: "processing" as const, claimToken, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "provider-failure-test",
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async (url) => {
        if (url.includes("spotify")) throw new Error("Spotify API request failed with HTTP 503");
        return source("tidal", url);
      },
      saveCatalogFailure: async (_jobId, _claimToken, link, error) => {
        failed.push({ platform: link.platform, catalogId: link.catalogId, error });
      },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      saveCatalogMetadata: async () => {},
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async () => assessment,
      saveAssessment: async () => {},
      generateReport: async () => new Uint8Array([37, 80, 68, 70, 45]),
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_jobId, _claimToken, message) => { throw new Error(message); },
    });

    expect(result.status).toBe("completed");
    expect(failed).toEqual([{
      platform: "spotify",
      catalogId: "spotify-fail",
      error: "Spotify API request failed with HTTP 503",
    }]);
  });


  it("persists provider failures even when every submitted DSP source is unavailable", async () => {
    const failed: string[] = [];
    const url = "https://tidal.com/browse/track/tidal-unavailable";
    let failureMessage = "";
    const result = await processAuditJob("all-providers-failed-job", {
      getJob: async () => ({
        id: "all-providers-failed-job", ownerId: null, sourceAudioPath: null, mimeType: null,
        sourceType: "dsp_link" as const, catalogUrl: url, catalogUrls: [url],
        status: "processing" as const, claimToken, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "provider-failure-test",
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async () => { throw new Error("TIDAL credentials unavailable"); },
      saveCatalogFailure: async (_jobId, _claimToken, link, error) => {
        failed.push(link.platform + ":" + link.catalogId + ":" + error);
      },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      saveCatalogMetadata: async () => {},
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async () => assessment,
      saveAssessment: async () => {},
      generateReport: async () => new Uint8Array([37, 80, 68, 70, 45]),
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_jobId, _claimToken, message) => { failureMessage = message; },
    });

    expect(result.status).toBe("failed");
    expect(failed).toEqual(["tidal:tidal-unavailable:TIDAL credentials unavailable"]);
    expect(failureMessage).toBe("Catalog lookup: the provider credentials or connection are unavailable. Check the submitted link and retry.");
  });

});
