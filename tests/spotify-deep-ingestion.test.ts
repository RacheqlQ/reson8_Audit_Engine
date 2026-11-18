import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("Spotify commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  });

  it("does not call Spotify when API credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platform: "spotify",
      catalogId: "spotify-track-123",
      evidenceStatus: "partial",
      raw: { providerPolicy: {
        provider: "spotify",
        status: "unavailable",
        reason: "not_configured",
        commercialStatus: "allowed",
      } },
    });
  });

  it("does not call Spotify when credentials are absent either", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.spotifyEnrichment).toMatchObject({ status: "unavailable" });
  });
});
