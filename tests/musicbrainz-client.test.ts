import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzClient, normalizeIsrc } from "../src/providers/musicbrainz/client.js";
import { collectIsrcCatalogMetadata } from "../src/providers/dsp/isrc-catalog.js";
import { providerDecision } from "../src/providers/provider-policy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("MusicBrainz ISRC catalogue client", () => {
  it("normalizes valid ISRCs and rejects malformed identifiers", () => {
    expect(normalizeIsrc("GB-AYE-12-12345")).toBe("GBAYE1212345");
    expect(normalizeIsrc("usabc2300001")).toBe("USABC2300001");
    expect(() => normalizeIsrc("not-an-isrc")).toThrow(/ISRC/i);
  });

  it("resolves an ISRC to recording identity and release label evidence", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      recordings: [{
        id: "recording-mbid",
        title: "Example Track",
        "artist-credit": [{ name: "Example Artist" }],
        releases: [{
          id: "release-mbid",
          title: "Example EP",
          date: "2024-03-01",
          "label-info": [{ label: { name: "Example Records" } }],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MusicBrainzClient().lookupIsrc("GB-AYE-12-12345");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe("/ws/2/isrc/GBAYE1212345");
    expect(requestedUrl.searchParams.get("inc")).toContain("recordings");
    expect(requestedUrl.searchParams.get("fmt")).toBe("json");
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((requestInit.headers as Record<string, string>)["User-Agent"]).toContain("https://reson8-audit-engine.onrender.com");
    expect(result).toEqual([{
      recordingId: "recording-mbid",
      title: "Example Track",
      artist: "Example Artist",
      releases: [{
        releaseId: "release-mbid",
        title: "Example EP",
        date: "2024-03-01",
        label: "Example Records",
      }],
      source: "musicbrainz",
    }]);
  });

  it("returns an empty result for a valid ISRC with no recording match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recordings: [] }), { status: 200 })));
    await expect(new MusicBrainzClient().lookupIsrc("GBAYE1212345")).resolves.toEqual([]);
  });

  it("uses the configured contact identifier in the MusicBrainz User-Agent", async () => {
    vi.stubEnv("MUSICBRAINZ_CONTACT", "ops@reson8.example");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ recordings: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new MusicBrainzClient().lookupIsrc("GBAYE1212345");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((requestInit.headers as Record<string, string>)["User-Agent"]).toBe("Reson8AuditEngine/1.0 (ops@reson8.example)");
  });

  it("enables live MusicBrainz ISRC lookup for evaluation without treating credentials as commercial authorization", async () => {
    vi.stubEnv("MUSICBRAINZ_API_KEY", "present-but-not-an-entitlement");
    vi.stubEnv("MUSICBRAINZ_ID", "account-id-is-not-contact-or-commercial-permission");
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recordings: [{
        id: "evaluation-recording-id",
        title: "Evaluation Track",
        "artist-credit": [{ name: "Evaluation Artist" }],
        releases: [{ id: "evaluation-release-id", title: "Evaluation EP", date: "2025-01-01" }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(providerDecision("musicbrainz")).toMatchObject({ enabled: true, commercialStatus: "unverified" });
    const result = await collectIsrcCatalogMetadata("GBAYE1212345");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata[0]).toMatchObject({
      platform: "musicbrainz",
      artist: "Evaluation Artist",
      title: "Evaluation Track",
      isrc: "GBAYE1212345",
    });
    expect(result.outcomes.find((outcome) => outcome.provider === "musicbrainz")).toMatchObject({
      status: "recognized",
      reason: expect.stringContaining("ISRC recording match"),
    });
  });

  it("fails closed on HTTP errors and never treats provider errors as empty matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(new MusicBrainzClient().lookupIsrc("GBAYE1212345")).rejects.toThrow(/HTTP 503/);
  });
});
