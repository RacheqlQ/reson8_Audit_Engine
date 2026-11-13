import { describe, expect, it } from "vitest";
import { processAuditJob } from "../src/jobs/process-audit-job.js";

const assessment = {} as import("../src/providers/groq/client.js").ArAssessment;

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
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "test-worker",
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
        samples: new Float32Array([0, 0, 0.1, 0.1, -0.1, -0.1, 0, 0]),
        sampleRate: 44100,
        channels: 2,
      }),
      saveSonicDna: async (_jobId, _claimToken, dna) => {
        events.push("dna");
        expect(dna.sampleRate).toBe(44100);
        expect(dna.channels).toBe(2);
        expect(dna.durationSeconds).toBe(4 / 44100);
      },
      generateAssessment: async (input) => {
        events.push("assessment");
        expect(input.sonicDna).toMatchObject({ provenance: "uploaded_audio_master" });
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
      saveReport: async (_jobId, _claimToken, tier, pdf, reportInput) => {
        expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
        if (tier === "full") expect(reportInput).toMatchObject({ auditId: "job-123" });
        events.push(`report-saved-${tier}`);
      },
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
      "report-sample",
      "report-saved-sample",
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
        genre: null,
        catalogPopularity: 0.61,
        catalogPopularityScale: "0_1" as const,
        artworkUrl: null,
        previewUrl: "https://example.com/preview.mp3",
        externalIds: { tidal: "tidal-123" },
        raw: {},
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
      recognizeUrl: async () => ({
        matched: true as const,
        artist: null,
        title: null,
        album: "AudD Album",
        isrc: "US-ABC-12-34567",
      }),
      saveRecognition: async () => {},
      saveEvidence: async (_jobId, _claimToken, recognition, reconciliation, metadata) => {
        expect(recognition.matched).toBe(true);
        expect(reconciliation.status).toBe("partial");
        expect(metadata?.platform).toBe("tidal");
      },
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
          evidenceClass: "RECOGNIZED",
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
      markFailed: async (_jobId, _claimToken, message) => {
        failureMessage = message;
        events.push("audit_failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(failureMessage).toContain("evidenceGaps[0] must contain at least 8 words");
    expect(events).toContain("recognition-saved");
    expect(events).toContain("evidence-saved");
    expect(events).toContain("sonic-dna-saved");
    expect(events.indexOf("recognition-saved")).toBeLessThan(events.indexOf("sonic-dna-saved"));
    expect(events.indexOf("sonic-dna-saved")).toBeLessThan(events.indexOf("audit_failed"));
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
      markFailed: async (_jobId, _claimToken, message) => {
        failure = message;
      },
    });

    expect(result.status).toBe("failed");
    expect(failure).toBe("master unavailable");
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
    expect(providerSignal).toBe(controller.signal);
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
