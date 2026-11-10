import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("Spotify deep catalog ingestion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  });

  it("uses the Spotify Web API track endpoint and preserves normalized catalog evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "test-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "spotify-track-123",
        name: "Dock of the Bay",
        artists: [{ id: "artist-123", name: "Otis Redding", external_urls: { spotify: "https://open.spotify.com/artist/artist-123" } }],
        album: {
          id: "album-123", name: "The Dock of the Bay", release_date: "1968-07-01",
          release_date_precision: "day", external_urls: { spotify: "https://open.spotify.com/album/album-123" },
          images: [{ url: "https://i.scdn.co/image/test" }],
        },
        duration_ms: 167000,
        external_ids: { isrc: "US-AT2-66-00001", upc: "123456789012" },
        external_urls: { spotify: "https://open.spotify.com/track/spotify-track-123" },
        is_playable: true,
        popularity: 61,
      }), { status: 200, headers: { "content-type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);
    process.env.SPOTIFY_CLIENT_ID = "client-id";
    process.env.SPOTIFY_CLIENT_SECRET = "client-secret";

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://accounts.spotify.com/api/token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.spotify.com/v1/tracks/spotify-track-123?market=US");
    expect(result).toMatchObject({
      platform: "spotify", catalogId: "spotify-track-123", artist: "Otis Redding",
      title: "Dock of the Bay", album: "The Dock of the Bay", releaseDate: "1968-07-01",
      isrc: "USAT26600001", upc: "123456789012",
      canonicalUrl: "https://open.spotify.com/track/spotify-track-123",
      externalIds: { spotify: "spotify-track-123" }, evidenceStatus: "recognized",
    });
    expect(result.raw).toMatchObject({ id: "spotify-track-123", duration_ms: 167000, is_playable: true, popularity: 61 });
  });

  it("keeps the audit alive when Spotify returns HTTP 403", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "test-access-token", token_type: "Bearer", expires_in: 3600,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { status: 403, message: "Forbidden" },
      }), { status: 403, headers: { "content-type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);
    process.env.SPOTIFY_CLIENT_ID = "client-id";
    process.env.SPOTIFY_CLIENT_SECRET = "client-secret";

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      platform: "spotify",
      catalogId: "spotify-track-123",
      artist: null,
      title: null,
      evidenceStatus: "partial",
      raw: {
        spotifyEnrichment: {
          status: "unavailable",
        },
      },
    });
    expect((result.raw.spotifyEnrichment as { error: string }).error).toContain("HTTP 403");
  });

  it("keeps the audit alive when Spotify credentials are not configured", async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(result).toMatchObject({
      platform: "spotify",
      catalogId: "spotify-track-123",
      evidenceStatus: "partial",
      raw: {
        spotifyEnrichment: {
          status: "unavailable",
        },
      },
    });
    expect((result.raw.spotifyEnrichment as { error: string }).error).toContain("Spotify client credentials are required");
  });
});
