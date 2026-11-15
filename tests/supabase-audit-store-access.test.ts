import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSupabaseAuditStore } from "../src/integrations/supabase-audit-store.js";

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


describe("DSP provider failure persistence", () => {
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
      catalogId: "tidal-456",
      canonicalUrl: "https://tidal.com/browse/track/tidal-456",
      status: "unavailable",
      error: "TIDAL track request failed with HTTP 503",
      evidenceClass: null,
    });
  });

});
