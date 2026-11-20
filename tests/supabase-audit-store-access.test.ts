import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { configuredStuckJobTimeoutMs, createSupabaseAuditStore } from "../src/integrations/supabase-audit-store.js";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalKey;
});

function makeStore(row: unknown, status = 200) {
  process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
  let requestUrl = "";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    requestUrl = input instanceof Request ? input.url : String(input);
    return new Response(
      status >= 400 ? JSON.stringify({ message: "database unavailable", code: "XX000" }) : JSON.stringify(row),
      { status, headers: { "content-type": "application/json", ...(status === 200 ? { "content-range": "0-0/1" } : {}) } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const store = createSupabaseAuditStore();
  return { store, fetchMock, getRequestUrl: () => requestUrl };
}

describe("Supabase capability-token verification adapter", () => {
  it("accepts the correct token when the selected job row contains its SHA-256 hash", async () => {
    const { store, getRequestUrl } = makeStore({ report_access_token_hash: hash(TOKEN_A) });
    await expect(store.verifyAuditAccessToken("job-a", TOKEN_A)).resolves.toBe(true);
    expect(getRequestUrl()).toContain("id=eq.job-a");
    expect(getRequestUrl()).toContain("select=report_access_token_hash");
  });

  it("rejects an incorrect token for the same job", async () => {
    const { store } = makeStore({ report_access_token_hash: hash(TOKEN_A) });
    await expect(store.verifyAuditAccessToken("job-a", TOKEN_B)).resolves.toBe(false);
  });

  it("rejects a token issued for a different job", async () => {
    const { store } = makeStore({ report_access_token_hash: hash(TOKEN_B) });
    await expect(store.verifyAuditAccessToken("job-b", TOKEN_A)).resolves.toBe(false);
  });

  it("preserves legacy rows with a null capability hash but denies token access", async () => {
    const { store } = makeStore({ report_access_token_hash: null });
    await expect(store.verifyAuditAccessToken("legacy-job", TOKEN_A)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    const { store } = makeStore({ report_access_token_hash: "not-a-sha256-hash" });
    await expect(store.verifyAuditAccessToken("job-a", TOKEN_A)).resolves.toBe(false);
  });

  it("fails closed when the database lookup returns an error", async () => {
    const { store } = makeStore(null, 500);
    await expect(store.verifyAuditAccessToken("job-a", TOKEN_A)).rejects.toThrow("Unable to verify audit access token");
  });
});


describe("audit status query efficiency", () => {
  it("keeps progress at reconciliation when a later Sonic DNA event is persisted", async () => {
    process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
    const job = { id: "job-progress", status: "processing", error_code: null, error_message: null, catalog_metadata: {} };
    const events = [
      { event_type: "sonic_dna", status: "completed", created_at: "2026-11-18T10:00:05.000Z", payload: {} },
      { event_type: "evidence_reconciliation", status: "completed", created_at: "2026-11-18T10:00:03.000Z", payload: {} },
      { event_type: "recognition", status: "completed", created_at: "2026-11-18T10:00:02.000Z", payload: {} },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/audit_jobs?") ? job : url.includes("/audit_events?") ? events : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const status = await createSupabaseAuditStore().getAuditStatus("job-progress");
    expect(status.currentStepIndex).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses three database round trips and returns structured failures and catalog state", async () => {
    process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
    const job = { id: "job-status", status: "failed", error_code: "capacity", error_message: "AI assessment: capacity exhausted.", catalog_metadata: {} };
    const events = [
      { event_type: "audit_failed", status: "failed", created_at: "2026-11-18T10:00:04.000Z", payload: { errorCode: "capacity", retryable: true } },
      { event_type: "ar_assessment", status: "completed", created_at: "2026-11-18T10:00:03.000Z", payload: {} },
      { event_type: "catalog_ingestion", status: "completed", created_at: "2026-11-18T10:00:02.000Z", payload: { platform: "spotify", canonicalUrl: "https://open.spotify.com/track/123", status: "recognized" } },
      { event_type: "catalog_ingestion", status: "partial", created_at: "2026-11-18T10:00:02.500Z", payload: { platform: "musicbrainz", canonicalUrl: "https://musicbrainz.org/ws/2/isrc/USABC1234567", lookupType: "isrc", isrc: "USABC1234567", status: "partial", reason: "Multiple recording candidates returned; ambiguous fields were withheld." } },
      { event_type: "catalog_links_submitted", status: "recognized", created_at: "2026-11-18T10:00:01.000Z", payload: { submittedLinks: ["https://open.spotify.com/track/123"] } },
    ];
    const reports = [{ tier: "full", version: 2, access_status: "available" }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/audit_jobs?") ? job : url.includes("/audit_events?") ? events : reports;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = createSupabaseAuditStore();
    const status = await store.getAuditStatus("job-status");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(status).toMatchObject({
      errorCode: "capacity", errorRetryable: true, currentStepIndex: 4, full: { available: true, version: 2 },
      catalogUrlsSubmitted: ["https://open.spotify.com/track/123"],
      catalogSources: [
        { platform: "spotify", status: "recognized" },
      ],

    });
  });
  it("does not present automatic ISRC provider attempts as submitted DSP evidence", async () => {
    process.env.SUPABASE_URL = "https://reson8-test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key";
    const job = { id: "job-isrc-only", status: "failed", error_code: "processing_error", error_message: "failed", catalog_metadata: {} };
    const events = [
      { event_type: "catalog_ingestion", status: "recognized", created_at: "2026-11-18T10:00:03.000Z", payload: { platform: "musicbrainz", canonicalUrl: "https://musicbrainz.org/ws/2/isrc/USABC1234567", lookupType: "isrc", isrc: "USABC1234567", status: "recognized", reason: "MusicBrainz returned an ISRC recording match." } },
      { event_type: "catalog_ingestion", status: "unavailable", created_at: "2026-11-18T10:00:04.000Z", payload: { platform: "spotify", canonicalUrl: "https://api.spotify.com/v1/search?q=isrc%3AUSABC1234567", lookupType: "isrc", isrc: "USABC1234567", status: "unavailable", reason: "Spotify API returned HTTP 403 Forbidden." } },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/audit_jobs?") ? job : url.includes("/audit_events?") ? events : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const status = await createSupabaseAuditStore().getAuditStatus("job-isrc-only");
    expect(status.catalogUrlsSubmitted).toEqual([]);
    expect(status.catalogSources).toEqual([]);
    expect(status.catalogSources).toEqual([]);
    expect(JSON.stringify(status)).not.toContain("api.spotify.com");
    expect(JSON.stringify(status)).not.toContain("musicbrainz.org/ws/2/isrc");
  });

});

describe("DSP provider failure persistence", () => {
  it("uses a validated configurable stuck-job timeout", () => {
    expect(configuredStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "300000" })).toBe(300_000);
    expect(configuredStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "invalid" })).toBe(600_000);
    expect(configuredStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "1000" })).toBe(600_000);
  });

  it("keeps the fenced SQL catalog metadata update idempotent and null-safe", () => {
    const migration = readFileSync(new URL("../supabase/migrations/20261118120000_coalesce_catalog_metadata_snapshot.sql", import.meta.url), "utf8");
    expect(migration).toContain("create or replace function public.persist_fenced_audit_step");
    expect(migration).toContain("catalog_metadata = coalesce(p_payload->'raw', '{}'::jsonb)");
    expect(migration).not.toMatch(/drop\\s+table|alter\\s+table/i);
  });

  it("normalizes null catalog metadata snapshots to an empty object before the fenced write", async () => {
    const { store, fetchMock } = makeStore({});
    const metadata = {
      platform: "spotify" as const, sourceUrl: "https://open.spotify.com/track/123",
      canonicalUrl: "https://open.spotify.com/track/123", catalogId: "123",
      artist: null, title: null, album: null, releaseDate: null, isrc: null, upc: null,
      catalogPopularity: null, catalogPopularityScale: null, label: null, genre: null,
      artworkUrl: null, previewUrl: null, externalIds: {}, sonicProfile: null,
      raw: null as unknown as Record<string, unknown>, evidenceStatus: "partial" as const,
    };
    await store.saveCatalogMetadata("job-null-raw", "claim-token", metadata);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.p_payload.raw).toEqual({});
  });

  it("persists sanitized provider attempt metadata as an audit event", async () => {
    const { store, fetchMock } = makeStore({});
    await store.recordProviderAttempt("job-provider-attempt", {
      provider: "gemini", model: "gemini-2.5-flash", status: 503,
      errorType: "provider_error", retryable: true, attempt: 2,
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      audit_job_id: "job-provider-attempt",
      event_type: "provider_attempt",
      status: "failed",
      payload: { provider: "gemini", model: "gemini-2.5-flash", httpStatus: 503, errorType: "provider_error", retryable: true, attempt: 2 },
    });
    expect(JSON.stringify(requestBody)).not.toContain("api_key");
    expect(JSON.stringify(requestBody)).not.toContain("prompt");
  });

  it("persists Spotify API failure status and a bounded reason for audit polling", async () => {
    const { store, fetchMock, getRequestUrl } = makeStore({});
    const metadata = {
      platform: "spotify" as const,
      sourceUrl: "https://open.spotify.com/track/123",
      canonicalUrl: "https://open.spotify.com/track/123",
      catalogId: "123",
      artist: null, title: null, album: null, releaseDate: null,
      isrc: null, upc: null, catalogPopularity: null, catalogPopularityScale: null,
      label: null, genre: null, artworkUrl: null, previewUrl: null,
      externalIds: {}, sonicProfile: null,
      raw: { spotifyEnrichment: { status: "unavailable", error: "Spotify API request failed with HTTP 401" } },
      evidenceStatus: "partial" as const,
    };

    await store.saveCatalogMetadata("job-123", "claim-token", metadata);

    expect(getRequestUrl()).toContain("persist_fenced_audit_step");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.p_payload.eventPayload).toMatchObject({
      status: "unavailable",
      error: "Spotify API request failed with HTTP 401",
    });
  });

  it("persists provider-level failures as catalog-ingestion events with bounded errors", async () => {
    const { store, fetchMock } = makeStore({});
    await store.saveCatalogFailure(
      "job-456",
      "claim-token",
      { platform: "tidal", catalogId: "tidal-456", canonicalUrl: "https://tidal.com/browse/track/tidal-456" },
      "TIDAL track request failed with HTTP 503",
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.p_operation).toBe("catalog_metadata");
    expect(requestBody.p_payload.eventPayload).toMatchObject({
      platform: "tidal",
      canonicalUrl: "https://tidal.com/browse/track/tidal-456",
      status: "unavailable",
      error: "TIDAL track request failed with HTTP 503",
      evidenceClass: null,
    });
  });


  it("persists ISRC provider outcomes with status, identifier and bounded reason", async () => {
    const { store, fetchMock } = makeStore({});
    await store.saveIsrcLookupOutcome("job-isrc", "claim-token", "USABC1234567", {
      provider: "musicbrainz",
      status: "partial",
      reason: "Multiple recording candidates returned; ambiguous fields were withheld.",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.p_operation).toBe("catalog_metadata");
    expect(requestBody.p_payload).toMatchObject({
      platform: "musicbrainz",
      catalogId: "USABC1234567",
      raw: { lookupType: "isrc", providerStatus: "partial" },
      eventPayload: {
        platform: "musicbrainz",
        lookupType: "isrc",
        isrc: "USABC1234567",
        status: "partial",
        evidenceClass: "PARTIAL",
      },
    });
  });

  it("fails an expired processing job older than ten minutes", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const { store, fetchMock } = makeStore([{ id: jobId }]);
    await expect(store.failExpiredProcessingJobs()).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const selectUrl = String(fetchMock.mock.calls[0]?.[0]);
    const updateUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(selectUrl).toContain("status=eq.processing");
    expect(selectUrl).toContain("lease_expires_at=lt.");
    expect(updateUrl).toContain("id=eq." + jobId);
    const updateBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(updateBody).toMatchObject({
      status: "failed",
      error_code: "AUDIT_JOB_EXPIRED",
      error_message: "This audit could not be completed within 10 minutes. Please submit it again.",
    });
  });

});


describe("Sonic DNA diagnostic event persistence", () => {
  it("stores bounded tempo and key diagnostics in audit_events without audio samples", async () => {
    const { store, fetchMock } = makeStore({});
    const dna = {
      durationSeconds: 8, sampleRate: 8000, channels: 1,
      rhythmFeatures: {
        method: "high_frequency_transient_autocorrelation",
        candidateScores: [{ bpm: 100, score: 0.91 }],
        onsetEnvelope: [0, 0.5, 1],
        beatTimesSeconds: [0.2, 0.8, 1.4],
        downbeatCandidateTimesSeconds: [0.2],
        beatGridStatus: "tentative",
        downbeatGridAssumption: "four-beat grouping for diagnostics only",
        windowConsensus: { winner: "120", windowCount: 4, observedAgreement: 1, lowerAgreementBound: 0.5, upperAgreementBound: 1, iterations: 1000, method: "deterministic_window_bootstrap" },
      },
      harmonicFeatures: {
        method: "fft_harmonic_chroma_ensemble",
        segmentChroma: [{ startSeconds: 0, endSeconds: 4, chroma: Array(12).fill(1 / 12) }],
        windowConsensus: { winner: "C:major", windowCount: 8, observedAgreement: 0.875, lowerAgreementBound: 0.5, upperAgreementBound: 1, iterations: 1000, method: "deterministic_window_bootstrap" },
      },
      vocalFeatures: {},
      bpm: 100, alternateTempo: 50, tempoConfidence: 0.91,
      key: "C", mode: "major", keyConfidence: 0.8, keyTuningCents: 7.5,
      keySegmentAgreement: 0.9, keyAnalysisFftButterflyCount: 100,
      limitations: [], loudnessLufs: null, rmsLevelDbfs: -12, rmsEnergy: 0.2,
      dynamicRangeDb: 8, spectralCentroidHz: 1000, spectralBandwidthHz: 200,
      spectralRolloffHz: 3000, zeroCrossingRate: 0.1, moodTags: [], genreContext: [],
      acousticFeatureProfile: {
        status: "measured",
        provenance: { featureVersion: "acoustic-profile-v1", windowCount: 128 },
        predictions: {
          mood: { status: "provisional", labels: ["driving", "tense"], method: "audio_feature_heuristics_v1", probability: null },
          energy: { status: "provisional", label: "high", score: 81, method: "audio_feature_heuristics_v1", probability: null },
        },
      },
    } as import("../src/audio/sonic-dna.js").SonicDnaFeatures;

    await store.saveSonicDna("job-diagnostics", "claim-token", dna);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.p_operation).toBe("sonic_dna");
    expect(requestBody.p_payload.rawFeatures.acousticFeatureProfile).toMatchObject({
      provenance: { featureVersion: "acoustic-profile-v1", windowCount: 128 },
      predictions: { mood: { labels: ["driving", "tense"] }, energy: { label: "high", score: 81 } },
    });
    expect(requestBody.p_payload.rawFeatures.rhythmFeatures.candidateScores).toEqual([{ bpm: 100, score: 0.91 }]);
    expect(requestBody.p_payload.rawFeatures.harmonicFeatures.windowConsensus).toMatchObject({ winner: "C:major", windowCount: 8 });
    expect(requestBody.p_payload.eventPayload.diagnostics).toMatchObject({
      version: 1,
      tempo: {
        candidateScores: [{ bpm: 100, score: 0.91 }],
        onsetEnvelope: [0, 0.5, 1],
        beatTimesSeconds: [0.2, 0.8, 1.4],
        downbeatCandidateTimesSeconds: [0.2],
        windowConsensus: { winner: "120", windowCount: 4, observedAgreement: 1, lowerAgreementBound: 0.5, upperAgreementBound: 1, iterations: 1000, method: "deterministic_window_bootstrap" },
      },
      key: {
        tuningCents: 7.5,
        segmentAgreement: 0.9,
        segmentChroma: [{ startSeconds: 0, endSeconds: 4 }],
        windowConsensus: { winner: "C:major", windowCount: 8, observedAgreement: 0.875, lowerAgreementBound: 0.5, upperAgreementBound: 1, iterations: 1000, method: "deterministic_window_bootstrap" },
      },
    });
    expect(JSON.stringify(requestBody.p_payload.eventPayload)).not.toContain("samples");
    expect(JSON.stringify(requestBody.p_payload.eventPayload)).not.toContain("audioBytes");
  });
});
