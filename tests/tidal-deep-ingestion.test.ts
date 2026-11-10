import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("TIDAL deep catalog ingestion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TIDAL_CLIENT_ID;
    delete process.env.TIDAL_CLIENT_SECRET;
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  });

  it("uses TIDAL OAuth client credentials and normalizes the track resource", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "tidal-access-token",
        token_type: "Bearer",
        expires_in: 86400,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          type: "tracks",
          id: "12345",
          attributes: {
            title: "Dock of the Bay",
            isrc: "USAT26600001",
            duration: 167,
            releaseDate: "1968-07-01",
            explicit: false,
            popularity: 0.61,
            bpm: 96,
            key: "A",
            keyScale: "minor",
            toneTags: ["Energetic", "Dark"],
            audioQuality: "LOSSLESS",
          },
          relationships: {
            artists: {
              data: [{ type: "artists", id: "artist-123" }],
            },
            albums: {
              data: [{ type: "albums", id: "album-123" }],
            },
            genres: {
              data: [{ type: "genres", id: "genre-123" }],
            },
            providers: {
              data: [{ type: "providers", id: "provider-123" }],
            },
          },
        },
        included: [
          {
            type: "artists",
            id: "artist-123",
            attributes: { name: "Otis Redding" },
          },
          {
            type: "albums",
            id: "album-123",
            attributes: {
              title: "The Dock of the Bay",
              releaseDate: "1968-07-01",
              numberOfVolumes: 1,
            },
          },
          {
            type: "genres",
            id: "genre-123",
            attributes: { name: "R&B" },
          },
          {
            type: "providers",
            id: "provider-123",
            attributes: { name: "Atlantic Records" },
          },
        ],
        links: {
          self: "https://openapi.tidal.com/v2/tracks/12345?countryCode=US&include=artists%2Calbums%2Cgenres%2Cproviders",
        },
      }), { status: 200, headers: { "content-type": "application/vnd.api+json" } }));

    vi.stubGlobal("fetch", fetchMock);
    process.env.TIDAL_CLIENT_ID = "client-id";
    process.env.TIDAL_CLIENT_SECRET = "client-secret";

    const result = await collectCatalogMetadata(
      "https://tidal.com/browse/track/12345",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://auth.tidal.com/v1/oauth2/token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://openapi.tidal.com/v2/tracks/12345?countryCode=US&include=artists%2Calbums%2Cgenres%2Cproviders",
    );
    expect(result).toMatchObject({
      platform: "tidal",
      catalogId: "12345",
      artist: "Otis Redding",
      title: "Dock of the Bay",
      album: "The Dock of the Bay",
      releaseDate: "1968-07-01",
      isrc: "USAT26600001",
      canonicalUrl: "https://tidal.com/browse/track/12345",
      externalIds: { tidal: "12345" },
      evidenceStatus: "recognized",
      genre: "R&B",
      label: "Atlantic Records",
      sonicProfile: {
        provenance: "tidal_catalog_metadata",
        bpm: 96,
        key: "A",
        mode: "minor",
        moodTags: ["Energetic", "Dark"],
        genreContext: ["R&B"],
      },
    });
    expect(result.raw).toMatchObject({
      data: {
        id: "12345",
        type: "tracks",
      },
    });
  });

  it("cross-references TIDAL ISRC against Spotify when TIDAL lacks genre", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "tidal-access-token",
        token_type: "Bearer",
        expires_in: 86400,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          type: "tracks",
          id: "12345",
          attributes: {
            title: "Dock of the Bay",
            isrc: "USAT26600001",
            releaseDate: "1968-07-01",
          },
          relationships: {
            artists: { data: [{ type: "artists", id: "artist-123" }] },
            albums: { data: [{ type: "albums", id: "album-123" }] },
          },
        },
        included: [
          { type: "artists", id: "artist-123", attributes: { name: "Otis Redding" } },
          { type: "albums", id: "album-123", attributes: { title: "The Dock of the Bay" } },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "spotify-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tracks: {
          items: [{
            id: "spotify-track-123",
            popularity: 74,
            artists: [{ id: "spotify-artist-123", name: "Otis Redding" }],
          }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "spotify-artist-123",
        genres: ["R&B", "Soul"],
      }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);
    process.env.TIDAL_CLIENT_ID = "tidal-client";
    process.env.TIDAL_CLIENT_SECRET = "tidal-secret";
    process.env.SPOTIFY_CLIENT_ID = "spotify-client";
    process.env.SPOTIFY_CLIENT_SECRET = "spotify-secret";

    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");

    expect(result.genre).toBe("R&B");
    expect(result.catalogPopularity).toBe(74);
    expect(result.externalIds).toMatchObject({
      tidal: "12345",
      spotify: "spotify-track-123",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://accounts.spotify.com/api/token",
    );
    expect(fetchMock.mock.calls[3]?.[0]).toContain(
      "https://api.spotify.com/v1/search?q=isrc%3AUSAT26600001",
    );
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "https://api.spotify.com/v1/artists/spotify-artist-123",
    );
  });

  it("fails closed when TIDAL credentials are not configured", async () => {
    await expect(
      collectCatalogMetadata("https://tidal.com/browse/track/12345"),
    ).rejects.toThrow("TIDAL client credentials are required");
  });

  it("surfaces TIDAL HTTP failures without returning partial placeholder metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
    );

    vi.stubGlobal("fetch", fetchMock);
    process.env.TIDAL_CLIENT_ID = "client-id";
    process.env.TIDAL_CLIENT_SECRET = "client-secret";

    await expect(
      collectCatalogMetadata("https://tidal.com/browse/track/12345"),
    ).rejects.toThrow("TIDAL token request failed with HTTP 401");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
