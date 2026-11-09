import { describe, expect, it } from "vitest";
import { processAuditJob } from "../src/jobs/process-audit-job.js";

const assessment = {
  assessmentVersion: "1.0",
  executiveSummary: "The supplied evidence supports a preliminary assessment of the recording's creative identity while leaving audience and market performance unverified. The report distinguishes measurable audio traits from interpretive positioning and records the limits of the available source material.",
  creativeIdentity: "The recording presents a groove-led R&B identity with a restrained rhythmic character. This is an interpretation of the supplied sonic context rather than a claim about audience response, commercial performance or confirmed genre classification.",
  strengths: ["The supplied tempo measurement gives the arrangement a concrete rhythmic reference for listening review.", "The audio profile provides measurable production characteristics that can support comparisons across approved masters.", "The reconciled identity fields provide a reliable starting point for track-level release documentation."],
  risks: ["No verified audience telemetry is available to establish listener demand, retention or conversion behaviour.", "The available evidence does not confirm release readiness, rights status or commercial performance across relevant platforms."],
  aAndRPositioning: {
    primaryLane: "R&B",
    adjacentLanes: ["Afro-R&B"],
    rationale: "The proposed R&B lane is a working creative hypothesis based on the supplied identity and sonic context. It should be validated against the complete master and the artist's catalogue before being used in an external A&R pitch.",
  },
  commercialRead: {
    marketability: "undetermined" as const,
    rationale: "No verified streaming, listener, sales, revenue or playlist-conversion evidence was supplied. Marketability remains undetermined until platform-native analytics are available with a clear source, reporting period and measurement definition.",
  },
  releaseStrategy: {
    recommendation: "Use the strongest verified creative and identity signals to frame the release, then validate the positioning through listening review and measurable audience response. Avoid commercial claims or increased campaign spend until source evidence is available.",
    priorities: ["Confirm release identity and rights metadata against authoritative distributor records.", "Review the complete approved master before finalizing creative positioning and production commentary.", "Collect verified platform and campaign measurements before evaluating commercial traction."],
  },
  evidenceGaps: ["No verified audience telemetry, listener retention history or campaign conversion data was supplied."],
  confidence: 0.8,
  limitations: ["The assessment is limited to supplied identity and audio evidence and cannot establish listener demand or commercial performance."],
  scorecard: {
    sonicIdentity: { score: 70, rationale: "The supplied audio measurements provide a useful but incomplete sonic profile. This score reflects descriptive coverage and does not claim audience demand or artistic quality." },
    metadataIntegrity: { score: 65, rationale: "The payload does not independently corroborate every release and rights field. This score reflects supplied metadata completeness only." },
    commercialEvidence: { score: null, rationale: "No verified audience, streaming, sales, revenue, or playlist-conversion evidence was supplied. A numeric score would imply unsupported certainty, so this dimension remains unscored until verified performance evidence is available." },
    releaseReadiness: { score: 55, rationale: "Identity and sonic context support preliminary planning, but audience validation and metadata checks remain outstanding. This score reflects evidence readiness rather than predicted performance or commercial outcomes." },
    hook: { score: null, rationale: "No supported hook-specific listening annotation or structural evidence was supplied for this fixture. The dimension remains unscored until complete master review identifies a repeatable hook." },
    originality: { score: null, rationale: "No comparative catalogue review or verified reference set is included, so originality cannot be judged without unsupported comparisons. This dimension remains unscored pending documented listening review." },
    production: { score: null, rationale: "The available measurements do not isolate mix, arrangement, vocal capture, mastering, or production decisions sufficiently to support a production-quality score. A detailed master review is required." },
    replayValue: { score: null, rationale: "No repeat-listening, completion, save, or retention telemetry is supplied. Replay value cannot be inferred from tempo or genre metadata, so this dimension remains unscored pending listener evidence." },
    laneClarity: { score: null, rationale: "The current metadata provides a provisional lane hypothesis, but no validated comparative listening review confirms how clearly the recording occupies that lane. Leave this dimension unscored until reviewed." },
  },
  evidenceLabels: [
    { label: "OBSERVED" as const, claim: "The supplied audio analysis reports a tempo measurement for the recording.", source: "sonicDna.bpm" },
    { label: "INFERRED" as const, claim: "The proposed creative lane is an interpretation and not a measured genre fact.", source: "sonicDna.genreContext" },
  ],
};

describe("processAuditJob", () => {
  it("moves a queued master through evidence, Sonic DNA, Groq assessment and completion", async () => {
    const events: string[] = [];
    const result = await processAuditJob("job-123", {
      getJob: async () => ({
        id: "job-123",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-123/master.wav",
        mimeType: "audio/wav",
        sourceType: "master",
        catalogUrl: null,
        status: "queued" as const,
      }),
      markProcessing: async () => events.push("processing"),
      collectCatalogMetadata: async () => { throw new Error("not used for master audits"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([4, 5]),
      recognize: async () => ({
        matched: true as const,
        artist: "Artist",
        title: "Song",
        spotifyUrl: "https://open.spotify.com/track/abc",
      }),
      saveRecognition: async () => events.push("recognition"),
      saveEvidence: async () => events.push("evidence"),
      decode: async () => ({
        samples: new Float32Array([0, 0.1, -0.1, 0]),
        sampleRate: 44100,
        channels: 1,
      }),
      saveSonicDna: async (_jobId, dna) => {
        events.push("dna");
        expect(dna.sampleRate).toBe(44100);
      },
      generateAssessment: async (input) => {
        events.push("assessment");
        expect(input.sonicDna).not.toBeNull();
        expect(input.evidence).toMatchObject({
          auditType: "MASTER-BASED AUDIT",
          artist: "Artist",
          title: "Song",
        });
        return assessment;
      },
      saveAssessment: async () => events.push("assessment-saved"),
      generateReport: async (_input, tier) => {
        events.push(`report-${tier}`);
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async (_jobId, tier) => events.push(`report-saved-${tier}`),
      markCompleted: async () => events.push("completed"),
      markFailed: async () => events.push("failed"),
    });

    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "processing",
      "recognition",
      "evidence",
      "dna",
      "assessment",
      "assessment-saved",
      "report-full",
      "report-saved-full",
      "completed",
    ]);
  });

  it("merges DSP identity with partial AudD enrichment before Groq and PDF generation", async () => {
    const assessmentInputs: Record<string, unknown>[] = [];
    const reportInputs: Record<string, unknown>[] = [];

    const result = await processAuditJob("job-dsp", {
      getJob: async () => ({
        id: "job-dsp",
        ownerId: "owner-123",
        sourceAudioPath: null,
        mimeType: null,
        sourceType: "dsp_link" as const,
        catalogUrl: "https://tidal.com/browse/track/tidal-123",
        status: "queued" as const,
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async () => ({
        platform: "tidal" as const,
        sourceUrl: "https://tidal.com/browse/track/tidal-123",
        canonicalUrl: "https://tidal.com/browse/track/tidal-123",
        catalogId: "tidal-123",
        artist: "TIDAL Artist",
        title: "TIDAL Title",
        album: null,
        releaseDate: null,
        isrc: null,
        upc: null,
        label: null,
        genre: null,
        catalogPopularity: 0.61,
        catalogPopularityScale: "0_1" as const,
        artworkUrl: null,
        previewUrl: "https://example.com/preview.mp3",
        externalIds: { tidal: "tidal-123" },
        raw: {},
        evidenceStatus: "verified" as const,
        sonicProfile: {
          provenance: "tidal_catalog_metadata" as const,
          bpm: 96,
          key: "A",
          mode: "minor" as const,
          moodTags: ["Energetic"],
          genreContext: ["R&B"],
        },
      }),
      recognizeUrl: async () => ({
        matched: true as const,
        artist: null,
        title: null,
        album: "AudD Album",
        isrc: "US-ABC-12-34567",
      }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      saveCatalogMetadata: async () => {},
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async (input) => {
        assessmentInputs.push(input.evidence);
        expect(input.sonicDna).toMatchObject({
          provenance: "tidal_catalog_metadata",
          bpm: 96,
          key: "A",
          mode: "minor",
          genreContext: ["R&B"],
        });
        return assessment;
      },
      saveAssessment: async () => {},
      generateReport: async (input) => {
        reportInputs.push(input.evidence);
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async () => {},
    });

    expect(result.status).toBe("completed");
    expect(assessmentInputs[0]).toMatchObject({
      artist: "TIDAL Artist",
      title: "TIDAL Title",
      album: "AudD Album",
      isrc: "USABC1234567",
      identity: {
        artist: "TIDAL Artist",
        title: "TIDAL Title",
        album: "AudD Album",
        sourceProviders: ["tidal", "audd"],
      },
    });
    expect(reportInputs[0]).toMatchObject({
      auditType: "METADATA-BASED AUDIT",
      artist: "TIDAL Artist",
      title: "TIDAL Title",
      album: "AudD Album",
    });
  });

  it("records a failed assessment event and never saves a report after Groq validation fails", async () => {
    const events: string[] = [];
    let failureMessage = "";
    const result = await processAuditJob("job-groq-failure", {
      getJob: async () => ({
        id: "job-groq-failure",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-groq-failure/master.wav",
        mimeType: "audio/wav",
        sourceType: "master",
        catalogUrl: null,
        status: "queued" as const,
      }),
      markProcessing: async () => { events.push("processing"); },
      collectCatalogMetadata: async () => { throw new Error("not used for master audits"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([4, 5]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async () => {
        throw new Error("Groq narrative response failed Zod validation after one retry: executiveSummary must contain at least 45 words.");
      },
      saveAssessment: async () => { events.push("assessment-saved"); },
      generateReport: async () => {
        events.push("report-generated");
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async () => { events.push("report-saved"); },
      markCompleted: async () => { events.push("completed"); },
      markFailed: async (_jobId, message) => {
        failureMessage = message;
        events.push("audit_failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(failureMessage).toContain("failed Zod validation after one retry");
    expect(events).toContain("audit_failed");
    expect(events).not.toContain("assessment-saved");
    expect(events).not.toContain("report-generated");
    expect(events).not.toContain("report-saved");
    expect(events).not.toContain("completed");
  });

  it("marks the job failed and preserves the error when processing fails", async () => {
    let failure = "";
    const result = await processAuditJob("job-123", {
      getJob: async () => ({
        id: "job-123",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-123/master.wav",
        mimeType: "audio/wav",
        sourceType: "master",
        catalogUrl: null,
        status: "queued" as const,
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async () => { throw new Error("not used for master audits"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => {
        throw new Error("master unavailable");
      },
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      decode: async () => {
        throw new Error("not reached");
      },
      saveSonicDna: async () => {},
      generateAssessment: async () => assessment,
      saveAssessment: async () => {},
      generateReport: async () => new Uint8Array(),
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_jobId, message) => {
        failure = message;
      },
    });

    expect(result.status).toBe("failed");
    expect(failure).toBe("master unavailable");
  });
});
