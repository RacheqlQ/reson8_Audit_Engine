import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("Spotify provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.SPOTIFY_PLAYLIST_MARKET;
  });

  it("reports missing Spotify credentials without treating the provider as policy-disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toBeUndefined();
    expect(result.raw.spotifyEnrichment).toMatchObject({ status: "unavailable", error: "Spotify client credentials are required" });
  });

  it("calls Spotify catalogue endpoints when credentials exist without a provider enable flag", async () => {
    process.env.SPOTIFY_CLIENT_ID = "test-client";
    process.env.SPOTIFY_CLIENT_SECRET = "test-secret";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("accounts.spotify.com/api/token")) {
        return new Response(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("api.spotify.com/v1/tracks/")) {
        return new Response(JSON.stringify({
          id: "spotify-track-123", name: "Approved Track", artists: [{ name: "Approved Artist" }],
          album: { name: "Approved Album", release_date: "2025-08-27" },
          external_ids: { isrc: "NGABC2600001" }, external_urls: { spotify: "https://open.spotify.com/track/spotify-track-123" },
        }), { status: 200 });
      }
      throw new Error("Unexpected Spotify request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ platform: "spotify", title: "Approved Track", artist: "Approved Artist", isrc: "NGABC2600001", evidenceStatus: "recognized" });
    expect(result.raw).not.toHaveProperty("providerPolicy");
  });
});
