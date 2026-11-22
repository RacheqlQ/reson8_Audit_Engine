import { describe, expect, it } from "vitest";
import { AI_ASSESSMENT_STAGE_TIMEOUT_MS, AUDIT_JOB_DEADLINE_MS, classifyAuditFailure, processAuditJob } from "../src/jobs/process-audit-job.js";
import { analyzeVocalStem } from "../src/audio/vocal-analysis.js";

const assessment = {} as import("../src/providers/groq/client.js").ArAssessment;

function id3Fixture(): Uint8Array {
  const encoder = new TextEncoder();
  const frame = (id: string, value: string): number[] => {
    const data = [3, ...encoder.encode(value)];
    return [...encoder.encode(id), 0, 0, 0, data.length, 0, 0, ...data];
  };
  const frames = [
    ...frame("TIT2", "Embedded Title"), ...frame("TPE1", "Embedded Artist"),
    ...frame("TALB", "Embedded Album"), ...frame("TSRC", "NGABC2600001"),
    ...frame("TCON", "Afrobeats"), ...frame("TDRC", "2025-08-27"),
    ...frame("TPUB", "BlackBeard Entertainment"),
  ];
  const size = frames.length;
  return new Uint8Array([73,68,51,4,0,0,(size>>21)&127,(size>>14)&127,(size>>7)&127,size&127,...frames]);
}



describe("audit failure classification", () => {
  it("keeps the assessment stage at ten minutes inside a longer job deadline", () => {
    expect(AI_ASSESSMENT_STAGE_TIMEOUT_MS).toBe(10 * 60_000);
    expect(AUDIT_JOB_DEADLINE_MS).toBe(20 * 60_000);
  });

  it("classifies malformed provider JSON as malformed output", () => {
    expect(classifyAuditFailure(new Error("json_validate_failed: Groq evidence-score response failed"))).toBe("malformed_output");
  });

  it("classifies exhausted upstream HTTP 402 billing responses as provider unavailable", () => {
    expect(classifyAuditFailure(new Error("Ollama assessment failed with HTTP 402"))).toBe("provider_unavailable");
  });

  it("classifies exhausted upstream 5xx responses as provider unavailable", () => {
    expect(classifyAuditFailure(new Error("Gemini assessment failed with HTTP 503"))).toBe("provider_unavailable");
    expect(classifyAuditFailure(new Error("provider_error: Ollama returned HTTP 502"))).toBe("provider_unavailable");
  });
});

describe("processAuditJob", () => {
  it("persists Sonic DNA before reconciliation, then assesses and completes a queued master", async () => {
    const events: string[] = [];
    let failureMessage = "";
    let failureCode = "";
    let reconciledIdentity: unknown = null;
    let persistedDna: Record<string, unknown> | null = null;
    let signalMeasurementTimestamp: string | undefined;
    const result = await processAuditJob("job-123", {
      getJob: async () => ({
        id: "job-123",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-123/master.wav",
        mimeType: "audio/mpeg",
        filename: "Filename Artist - Filename Title.mp3",
        sourceType: "master",
        catalogUrl: null,
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test-worker",
      }),
      markProcessing: async () => events.push("processing"),
      collectCatalogMetadata: async () => { throw new Error("not used for master audits"); },
      collectIsrcCatalogMetadata: async () => {
        events.push("isrc-catalog-lookup");
        return { isrc: "NGABC2600001", metadata: [], outcomes: [{ provider: "musicbrainz", status: "partial", reason: "No fixture match; external lookup intentionally mocked." }] };
      },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => id3Fixture(),
      createRecognitionSample: async () => new Uint8Array([4, 5]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => events.push("recognition"),
      saveEvidence: async (_jobId, _claimToken, _recognition, reconciliation) => {
        reconciledIdentity = reconciliation.identity;
        expect(reconciliation.identity).toMatchObject({
          artist: "Embedded Artist", title: "Embedded Title", album: "Embedded Album",
          isrc: "NGABC2600001", genres: ["Afrobeats"], releaseDate: "2025-08-27",
          label: "BlackBeard Entertainment",
        });
        events.push("evidence");
      },
      decode: async () => ({
        samples: new Float32Array([0, 0, 0.1, 0.1, -0.1, -0.1, 0, 0]),
        sampleRate: 44100,
        channels: 2,
      }),
      analyzeVocals: async () => {
        events.push("vocal-analysis");
        const sampleRate = 8000;
        const mix = Float32Array.from({ length: sampleRate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / sampleRate));
        const vocal = Float32Array.from({ length: sampleRate }, (_, i) => 0.25 * Math.sin(2 * Math.PI * 220 * i / sampleRate));
        return analyzeVocalStem([vocal], [mix], sampleRate);
      },
      saveSonicDna: async (_jobId, _claimToken, dna) => {
        persistedDna = dna as unknown as Record<string, unknown>;
        const hasVocalResult = (dna.vocalFeatures as { status?: string }).status === "analyzed";
        events.push(hasVocalResult ? "dna-final" : "dna-base");
        if (hasVocalResult) {
          expect(dna.vocalFeatures).toMatchObject({ status: "analyzed", voicePresence: "likely_present" });
        }
        expect(dna.sampleRate).toBe(44100);
        expect(dna.channels).toBe(2);
        expect(dna.durationSeconds).toBe(4 / 44100);
        expect(dna.acousticFeatureProfile.predictions).toMatchObject({
          mood: { status: "unavailable", reasonCode: "INSUFFICIENT_ANALYSIS_WINDOWS" },
          energy: { status: "unavailable", reasonCode: "INSUFFICIENT_ANALYSIS_WINDOWS" },
        });
      },
      discoverPlaylists: async (input) => { events.push("playlist-discovery"); expect(input.isrc).toBe("NGABC2600001"); return { status: "available" as const, outcomes: [{ provider: "apple_music" as const, status: "available" as const, reason: "Deterministic test provider result." }], candidates: [{ provider: "apple_music" as const, id: "pl-test", name: "Afrobeats Discovery", url: "https://music.apple.com/ng/playlist/afrobeats-discovery/pl-test", sourceUrl: "https://music.apple.com/ng/playlist/afrobeats-discovery/pl-test", curatorName: "Apple Music", playlistType: "editorial", description: "Afrobeats selections", trackCount: 20, genreMatches: ["Afrobeats"], moodMatches: [], matchBasis: ["Primary genre match: Afrobeats"], containsIsrc: false, retrievedAt: "2026-11-19T12:00:00.000Z" }] }; },
      generateAssessment: async (input) => {
        events.push("assessment");
        expect(input.sonicDna).toMatchObject({ provenance: "uploaded_audio_master" });
        expect(input.sonicDna).toHaveProperty("keySegmentAgreement", persistedDna?.keySegmentAgreement);
        expect(input.sonicDna).toHaveProperty("keyTuningCents", persistedDna?.keyTuningCents);
        expect(input.evidence).not.toHaveProperty("playlistDiscovery");
        expect(input.evidence).toMatchObject({
          auditType: "MASTER-BASED AUDIT",
          metadataSourcesChecked: ["musicbrainz", "id3", "filename", "audd"],
          artist: "Embedded Artist",
          title: "Embedded Title",
          album: "Embedded Album",
          isrc: "NGABC2600001",
          genres: ["Afrobeats"],
        });
        return assessment;
      },
      saveAssessment: async () => events.push("assessment-saved"),
      generateReport: async (_input, tier) => {
        expect((_input.evidence as Record<string, unknown>).playlistDiscovery).toMatchObject({ status: "available", candidates: [{ name: "Afrobeats Discovery", provider: "apple_music" }] });
        expect(_input.executionMode).toBe("master");
        expect((_input.realMasterContract as { directSignalMeasurements: Array<{ name: string; unit: string }> }).directSignalMeasurements)
          .toEqual(expect.arrayContaining([expect.objectContaining({ name: "rms_envelope_spread_db", unit: "dB" })]));
        expect(_input.sonicDna?.acousticFeatureProfile).toEqual(persistedDna?.acousticFeatureProfile);
        expect(_input.sonicDna?.rhythmFeatures).toEqual(persistedDna?.rhythmFeatures);
        expect(_input.sonicDna?.harmonicFeatures).toEqual(persistedDna?.harmonicFeatures);
        signalMeasurementTimestamp = (_input.realMasterContract as { directSignalMeasurements: Array<{ name: string; measuredAt?: string }> }).directSignalMeasurements.find((metric) => metric.name === "sample_rate_hz")?.measuredAt;
        expect(_input.realMasterContract).toMatchObject({ schemaVersion: "1.0.0", auditId: "job-123", source: { sourceKind: "uploaded_master", sourceAudioPath: "owner-123/job-123/master.wav", mimeType: "audio/mpeg", byteLength: id3Fixture().byteLength } });
        expect((_input.realMasterContract as { externalRecords: Array<{ provider: string; status: string }> }).externalRecords).toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "musicbrainz", status: "unavailable" }),
        ]));
        expect((_input.realMasterContract as { calibratedPredictions: Array<{ name: string; status: string }> }).calibratedPredictions).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: "calibrated_audio_mood", status: "unavailable" }),
          expect.objectContaining({ name: "calibrated_key_mode_probability", status: "unavailable" }),
        ]));
        events.push(`report-${tier}`);
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async (_jobId, _claimToken, tier, pdf, reportInput) => {
        expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
        if (tier === "full") expect(reportInput).toMatchObject({ auditId: "job-123", executionMode: "master", realMasterContract: { schemaVersion: "1.0.0", source: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
        events.push(`report-saved-${tier}`);
      },
      markCompleted: async () => events.push("completed"),
      markFailed: async (_jobId, _claimToken, message, _signal, errorCode) => { failureMessage = message; failureCode = errorCode ?? ""; events.push("failed"); },
    });

    expect(result.status, failureMessage + " | code: " + failureCode + " | events: " + events.join(",") + " | identity: " + JSON.stringify(reconciledIdentity)).toBe("completed");
    expect(signalMeasurementTimestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(signalMeasurementTimestamp!))).toBe(false);
    expect(events).toEqual([
      "processing",
      "dna-base",
      "recognition",
      "isrc-catalog-lookup",
      "vocal-analysis",
      "dna-final",
      "evidence",
      "assessment",
      "assessment-saved",
      "playlist-discovery",
      "report-sample",
      "report-saved-sample",
      "report-full",
      "report-saved-full",
      "completed",
    ]);
  });

  it("merges DSP identity with partial AudD enrichment before Groq and PDF generation", async () => {
    const assessmentInputs: Record<string, unknown>[] = [];
    const assessmentCatalogInputs: Record<string, unknown>[] = [];
    const reportInputs: Record<string, unknown>[] = [];
    let failureMessage = "";
    let failureCode = "";
    let stageError = "";

    const result = await processAuditJob("job-dsp", {
      getJob: async () => ({
        id: "job-dsp",
        ownerId: "owner-123",
        sourceAudioPath: null,
        mimeType: null,
        sourceType: "dsp_link" as const,
        catalogUrl: "https://tidal.com/browse/track/tidal-123",
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test-worker",
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
        genre: "Spotify-derived genre",
        catalogPopularity: 0.61,
        catalogPopularityScale: "0_1" as const,
        artworkUrl: null,
        previewUrl: "https://example.com/preview.mp3",
        externalIds: { tidal: "tidal-123", spotify: "spotify-cross-reference" },
        raw: { crossReferences: { spotify: { id: "spotify-cross-reference", genres: ["Spotify-derived genre"] } } },
        evidenceStatus: "recognized" as const,
        sonicProfile: {
          provenance: "tidal_catalog_metadata" as const,
          bpm: 96,
          key: "A",
          mode: "minor" as const,
          moodTags: ["Energetic"],
          genreContext: ["R&B"],
        },
      }),
      collectIsrcCatalogMetadata: async (isrc) => ({ isrc, metadata: [], outcomes: [
        { provider: "musicbrainz", status: "partial", reason: "No fixture match; external lookup intentionally mocked." },
        { provider: "spotify", status: "not_configured", reason: "Spotify credentials are not configured in this deterministic test." },
      ] }),
      recognizeUrl: async () => ({
        matched: true as const,
        artist: null,
        title: null,
        album: "AudD Album",
        isrc: "US-ABC-12-34567",
      }),
      saveRecognition: async () => {},
      saveEvidence: async (_jobId, _claimToken, recognition, reconciliation, metadata) => {
        try {
          expect(recognition.matched).toBe(true);
          expect(reconciliation.status).toBe("partial");
          expect(metadata?.platform).toBe("tidal");
        } catch (error) { stageError = `saveEvidence: ${error instanceof Error ? error.message : String(error)}`; throw error; }
      },
      saveCatalogMetadata: async () => {},
      downloadMaster: async () => new Uint8Array(),
      createRecognitionSample: async () => new Uint8Array(),
      recognize: async () => ({ matched: false as const }),
      decode: async () => ({ samples: new Float32Array(), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async (input) => {
        try {
          assessmentInputs.push(input.evidence);
          assessmentCatalogInputs.push(input.catalogMetadata ?? {});
          expect(input.evidence.metadataSourcesChecked).toEqual(["tidal", "musicbrainz", "audd"]);
          expect(input.sonicDna).toMatchObject({
            provenance: "tidal_catalog_metadata",
            evidenceClass: "RECOGNIZED",
            bpm: 96,
            key: "A",
            mode: "minor",
            genreContext: ["R&B"],
          });
          return assessment;
        } catch (error) { stageError = `generateAssessment: ${error instanceof Error ? error.message : String(error)}`; throw error; }
      },
      saveAssessment: async () => {},
      generateReport: async (input) => {
        try { reportInputs.push(input.evidence); return new Uint8Array([37, 80, 68, 70, 45]); }
        catch (error) { stageError = `generateReport: ${error instanceof Error ? error.message : String(error)}`; throw error; }
      },
      saveReport: async () => {},
      markCompleted: async () => {},
      markFailed: async (_jobId, _claimToken, message, _signal, errorCode) => { failureMessage = message; failureCode = errorCode ?? ""; },
    });

    expect(result.status, `${failureMessage} | code=${failureCode} | stage=${stageError}`).toBe("completed");
    expect(assessmentCatalogInputs[0]).toMatchObject({ genre: null, catalogPopularity: null });
    expect(assessmentCatalogInputs[0]).not.toHaveProperty("externalIds.spotify");
    expect(assessmentCatalogInputs[0]).not.toHaveProperty("raw.crossReferences.spotify");
    expect(assessmentInputs[0]).toMatchObject({
      evidenceClass: "RECOGNIZED",
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

  it("preserves recognition and Sonic DNA when the second evidence-score validation fails", async () => {
    const events: string[] = [];
    let failureMessage = "";
    let failureCode = "";
    const result = await processAuditJob("job-groq-failure", {
      getJob: async () => ({
        id: "job-groq-failure",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-groq-failure/master.wav",
        mimeType: "audio/wav",
        sourceType: "master",
        catalogUrl: null,
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test-worker",
      }),
      markProcessing: async () => { events.push("processing"); },
      collectCatalogMetadata: async () => { throw new Error("not used for master audits"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([4, 5]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => { events.push("recognition-saved"); },
      saveEvidence: async () => { events.push("evidence-saved"); },
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => { events.push("sonic-dna-saved"); },
      generateAssessment: async () => {
        throw new Error("Groq evidence-score response failed Zod validation after one retry: evidenceGaps[0] must contain at least 8 words.");
      },
      saveAssessment: async () => { events.push("assessment-saved"); },
      generateReport: async () => {
        events.push("report-generated");
        return new Uint8Array([37, 80, 68, 70, 45]);
      },
      saveReport: async () => { events.push("report-saved"); },
      markCompleted: async () => { events.push("completed"); },
      markFailed: async (_jobId, _claimToken, message, _signal, errorCode) => {
        failureMessage = message;
        failureCode = errorCode ?? "";
        events.push("audit_failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(failureMessage).toBe("AI assessment: the generated response did not meet the report's validation requirements. Please retry later.");
    expect(failureCode).toBe("malformed_output");
    expect(events).toContain("recognition-saved");
    expect(events).toContain("evidence-saved");
    expect(events).toContain("sonic-dna-saved");
    // The master measurement is persisted immediately after analysis, before
    // recognition/reconciliation; the enriched DNA write may follow recognition.
    expect(events.indexOf("sonic-dna-saved")).toBeLessThan(events.indexOf("recognition-saved"));
    expect(events.indexOf("recognition-saved")).toBeLessThan(events.indexOf("evidence-saved"));
    expect(events.indexOf("evidence-saved")).toBeLessThan(events.indexOf("audit_failed"));
    expect(events).toContain("audit_failed");
    expect(events).not.toContain("assessment-saved");
    expect(events).not.toContain("report-generated");
    expect(events).not.toContain("report-saved");
    expect(events).not.toContain("completed");
  });

  it("marks the job failed and preserves the error when processing fails", async () => {
    let failure = "";
    let failureCode = "";
    const result = await processAuditJob("job-123", {
      getJob: async () => ({
        id: "job-123",
        ownerId: "owner-123",
        sourceAudioPath: "owner-123/job-123/master.wav",
        mimeType: "audio/wav",
        sourceType: "master",
        catalogUrl: null,
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test-worker",
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
      markFailed: async (_jobId, _claimToken, message, _signal, errorCode) => {
        failure = message;
        failureCode = errorCode ?? "";
      },
    });

    expect(result.status).toBe("failed");
    expect(failure).toBe("Audio intake: the uploaded master could not be retrieved. Re-upload it and retry.");
    expect(failureCode).toBe("processing_error");
  });
  it("aborts after lease loss and prevents assessment, report, and terminal persistence", async () => {
    const controller = new AbortController();
    let releaseAssessment!: () => void;
    let assessmentStarted!: () => void;
    const started = new Promise<void>((resolve) => { assessmentStarted = resolve; });
    const assessmentGate = new Promise<void>((resolve) => { releaseAssessment = resolve; });
    const writes: string[] = [];

    const deps = {
      signal: controller.signal,
      getJob: async () => ({
        id: "lease-loss-job", ownerId: null, sourceAudioPath: "fixture/master.wav",
        mimeType: "audio/wav", sourceType: "master" as const, catalogUrl: null,
        status: "processing" as const, claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z", workerId: "lease-loss-test",
      }),
      markProcessing: async () => { writes.push("processing"); },
      collectCatalogMetadata: async () => { throw new Error("not used"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([1, 2]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => { writes.push("recognition"); },
      saveEvidence: async () => { writes.push("evidence"); },
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => { writes.push("sonic-dna"); },
      generateAssessment: async () => {
        assessmentStarted();
        await assessmentGate;
        return assessment;
      },
      saveAssessment: async () => { writes.push("assessment"); },
      generateReport: async () => { writes.push("report-generated"); return new Uint8Array([37, 80, 68, 70, 45]); },
      saveReport: async () => { writes.push("report-saved"); },
      markCompleted: async () => { writes.push("completed"); },
      markFailed: async () => { writes.push("failed"); },
    } as unknown as import("../src/jobs/process-audit-job.js").AuditProcessorDependencies;

    const processing = processAuditJob("lease-loss-job", deps);
    await started;
    controller.abort(new Error("AUDIT_LEASE_LOST"));
    releaseAssessment();

    await expect(processing).rejects.toThrow("AUDIT_LEASE_LOST");
    expect(writes).toContain("recognition");
    expect(writes).toContain("evidence");
    expect(writes).toContain("sonic-dna");
    expect(writes).not.toContain("assessment");
    expect(writes).not.toContain("report-generated");
    expect(writes).not.toContain("report-saved");
    expect(writes).not.toContain("completed");
    expect(writes).not.toContain("failed");
  });

  it("passes the lease signal to an in-flight provider and safely observes its late rejection", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const writes: string[] = [];
    const deps = {
      signal: controller.signal,
      getJob: async () => ({
        id: "provider-abort-job", ownerId: null, sourceAudioPath: "fixture/master.wav",
        mimeType: "audio/wav", sourceType: "master" as const, catalogUrl: null,
        status: "processing" as const, claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z", workerId: "provider-abort-test",
      }),
      markProcessing: async () => { writes.push("processing"); },
      collectCatalogMetadata: async () => { throw new Error("not used"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([1, 2]),
      recognize: async (_sample: Uint8Array, signal?: AbortSignal) => {
        providerSignal = signal;
        providerStarted();
        return new Promise<import("../src/providers/audd/normalize.js").AuditRecognition>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("provider aborted")), { once: true });
        });
      },
      saveRecognition: async () => { writes.push("recognition"); },
      saveEvidence: async () => { writes.push("evidence"); },
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => { writes.push("sonic-dna"); },
      generateAssessment: async () => { writes.push("assessment"); return assessment; },
      saveAssessment: async () => { writes.push("assessment-saved"); },
      generateReport: async () => new Uint8Array([37, 80, 68, 70, 45]),
      saveReport: async () => { writes.push("report-saved"); },
      markCompleted: async () => { writes.push("completed"); },
      markFailed: async () => { writes.push("failed"); },
    } as unknown as import("../src/jobs/process-audit-job.js").AuditProcessorDependencies;

    const processing = processAuditJob("provider-abort-job", deps);
    await started;
    expect(providerSignal).not.toBe(controller.signal);
    controller.abort(new Error("AUDIT_LEASE_LOST"));

    await expect(processing).rejects.toThrow("AUDIT_LEASE_LOST");
    await Promise.resolve();
    expect(writes).toEqual(["processing"]);
  });

  it("waits for late report-upload cleanup before the aborted processor settles", async () => {
    const controller = new AbortController();
    let finishUpload!: () => void;
    let finishCleanup!: () => void;
    let reportStarted!: () => void;
    let cleanupStarted!: () => void;
    const uploadGate = new Promise<void>((resolve) => { finishUpload = resolve; });
    const cleanupGate = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const started = new Promise<void>((resolve) => { reportStarted = resolve; });
    const cleaning = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    const writes: string[] = [];
    const deps = {
      signal: controller.signal,
      getJob: async () => ({
        id: "late-report-job", ownerId: null, sourceAudioPath: "fixture/master.wav",
        mimeType: "audio/wav", sourceType: "master" as const, catalogUrl: null,
        status: "processing" as const, claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z", workerId: "late-report-test",
      }),
      markProcessing: async () => { writes.push("processing"); },
      collectCatalogMetadata: async () => { throw new Error("not used"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([1, 2]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => { writes.push("recognition"); },
      saveEvidence: async () => { writes.push("evidence"); },
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => { writes.push("sonic-dna"); },
      generateAssessment: async () => assessment,
      saveAssessment: async () => { writes.push("assessment"); },
      generateReport: async () => new Uint8Array([37, 80, 68, 70, 45]),
      saveReport: async (_jobId: string, _claimToken: string, _tier: string, _pdf: Uint8Array, _input?: unknown, signal?: AbortSignal) => {
        reportStarted();
        await uploadGate;
        if (signal?.aborted) {
          cleanupStarted();
          await cleanupGate;
          throw signal.reason;
        }
      },
      markCompleted: async () => { writes.push("completed"); },
      markFailed: async () => { writes.push("failed"); },
    } as unknown as import("../src/jobs/process-audit-job.js").AuditProcessorDependencies;

    const processing = processAuditJob("late-report-job", deps);
    await started;
    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    let settled = false;
    void processing.finally(() => { settled = true; }).catch(() => {});
    finishUpload();
    await cleaning;
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCleanup();
    await expect(processing).rejects.toThrow("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    expect(writes).not.toContain("completed");
    expect(writes).not.toContain("failed");
  });

});
