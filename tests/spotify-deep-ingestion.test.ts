import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("Spotify commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.PROVIDER_ENABLED_SPOTIFY;
  });

  it("does not call Spotify when credentials and the opt-in flag are present but commercial status is unverified", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SPOTIFY_CLIENT_ID = "client-id";
    process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
    process.env.PROVIDER_ENABLED_SPOTIFY = "true";

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platform: "spotify",
      catalogId: "spotify-track-123",
      evidenceStatus: "partial",
      raw: { providerPolicy: {
        provider: "spotify",
        status: "unavailable",
        reason: "disabled by data policy",
        commercialStatus: "unverified",
      } },
    });
  });

  it("does not call Spotify when credentials are absent either", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://open.spotify.com/track/spotify-track-123");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toMatchObject({ reason: "disabled by data policy" });
  });
});
