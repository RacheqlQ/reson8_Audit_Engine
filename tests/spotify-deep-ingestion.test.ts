import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("Spotify provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
  });

  it("reports missing Spotify credentials without treating the provider as policy-disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toBeUndefined();
    expect(result.raw.spotifyEnrichment).toMatchObject({ status: "unavailable", error: "Spotify client credentials are required" });
  });
});
