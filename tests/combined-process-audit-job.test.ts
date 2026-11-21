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
  externalIds: { spotify: "abc" }, raw: {}, evidenceStatus: "recognized", retrievedAt: "2026-11-19T12:00:00.000Z",
  sonicProfile: null,
} as CatalogMetadata;

describe("combined master and DSP processing", () => {
  it("merges catalog identity and master-measured Sonic DNA into one sample/full report pair", async () => {
    const events: string[] = [];
    let assessmentInput: any;
    let externalRecordsCaptured: unknown;
    const persistedIsrcOutcomes: unknown[] = [];
    const recognition: AuditRecognition = { matched: true, title: "Master Song", artist: "Master Artist", isrc: "not-an-isrc" };
    const musicBrainzMetadata: CatalogMetadata = {
      ...metadata,
      platform: "musicbrainz",
      sourceUrl: "https://musicbrainz.org/ws/2/isrc/USABC1234567",
      canonicalUrl: "https://musicbrainz.org/recording/recording-mbid",
      catalogId: "recording-mbid",
      catalogPopularity: null,
      catalogPopularityScale: null,
      externalIds: { musicbrainz: "recording-mbid" },
      raw: { provider: "musicbrainz" },
    };

    const reportInputs: unknown[] = [];
    const result = await processAuditJob("combined-1", {
      getJob: async () => ({
        id: "combined-1", ownerId: null, sourceAudioPath: "anonymous/combined-1/master.wav",
        mimeType: "audio/wav", sourceType: "combined", catalogUrl: metadata.sourceUrl,
        status: "processing", claimToken: "claim-1", leaseExpiresAt: "2099-01-01T00:00:00Z", workerId: "test",
      }),
      markProcessing: async () => { events.push("processing"); },
      collectCatalogMetadata: async () => { events.push("catalog"); return metadata; },
      collectIsrcCatalogMetadata: async (isrc) => {
        events.push("isrc-catalog");
        expect(isrc).toBe("USABC1234567");
        return { isrc: "USABC1234567", metadata: [musicBrainzMetadata], outcomes: [
          { provider: "musicbrainz", status: "recognized", reason: "MusicBrainz returned an ISRC recording match." },
          { provider: "spotify", status: "not_configured", reason: "Spotify client credentials are not configured or provider policy is disabled." },
        ] };
      },
      saveIsrcLookupOutcome: async (_id, _token, isrc, outcome) => {
        persistedIsrcOutcomes.push({ isrc, ...outcome });
      },
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
        reportInputs.push(input);
        events.push("generated-"+tier);
        expect(input.evidence).toMatchObject({ sourceCombination: "master_and_dsp", artist: "Master Artist", title: "Master Song" });
        expect(input.evidence.canonicalEvidence).toMatchObject({
          schemaVersion: "1.0.0",
          auditId: "combined-1",
          sourceEvidence: { sourceCombination: "master_and_dsp" },
          assessmentEvidence: { sourceCombination: "master_and_dsp" },
          reconciliation: { reconciledFields: expect.any(Array) },
        });
        expect(input.evidence.canonicalEvidence.assessmentEvidence).toBe(assessmentInput.evidence);
        expect(input.evidence.canonicalEvidence.identityFieldProvenance).toEqual(assessmentInput.evidence.identity.fieldProvenance);
        expect(input.sonicDna).toMatchObject({ provenance: "uploaded_audio_master", evidenceClass: "OBSERVED" });
        expect(input.sonicDna).toHaveProperty("tempoCandidateBpm");
        expect(input.sonicDna).toHaveProperty("keyCandidates");
        expect(input.sonicDna).toHaveProperty("tuningEvidenceWindows");
        externalRecordsCaptured = input.realMasterContract?.externalRecords;
        return new Uint8Array([37,80,68,70,45]);
      },
      saveReport: async (_id, _token, tier, _pdf, reportInput) => {
        events.push("saved-"+tier);
        if(tier==="full"){
          expect(reportInput).toBe(reportInputs[0]);
          expect(reportInput).toMatchObject({
            evidence:{sourceCombination:"master_and_dsp"},
            sonicDna:expect.any(Object),
            assessment:expect.any(Object),
          });
        }
      },
      markCompleted: async () => { events.push("completed"); },
      markFailed: async (_id, _token, message) => { throw new Error(message); },
    });

    expect(result.status).toBe("completed");
    expect(reportInputs).toHaveLength(2);
    expect(reportInputs[0]).toBe(reportInputs[1]);
    expect(externalRecordsCaptured).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "musicbrainz", status: "verified", retrievedAt: "2026-11-19T12:00:00.000Z" }),
      expect.objectContaining({ provider: "spotify", status: "verified", retrievedAt: expect.any(String) }),
    ]));
    expect(persistedIsrcOutcomes).toEqual([
      { isrc: "USABC1234567", provider: "musicbrainz", status: "recognized", reason: "MusicBrainz returned an ISRC recording match." },
      { isrc: "USABC1234567", provider: "spotify", status: "not_configured", reason: "Spotify client credentials are not configured or provider policy is disabled." },
    ]);
    expect(assessmentInput.evidence).toMatchObject({ sourceCombination: "master_and_dsp" });
    expect(assessmentInput.evidence).toMatchObject({ platform: "musicbrainz" });
    expect(assessmentInput.catalogMetadata).toMatchObject({ platform: "musicbrainz", artist: "Master Artist", title: "Master Song" });
    expect(assessmentInput.sonicDna).toMatchObject({ provenance: "uploaded_audio_master" });
    expect(events).toContain("catalog-saved");
    expect(events).toContain("isrc-catalog");
    expect(events).toContain("master-downloaded");
    expect(events).toContain("dna-saved");
    expect(events).toContain("saved-sample");
    expect(events).toContain("saved-full");
    expect(events.at(-1)).toBe("completed");
  });
});
