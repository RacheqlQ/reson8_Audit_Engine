import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("TIDAL provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TIDAL_CLIENT_ID;
    delete process.env.TIDAL_CLIENT_SECRET;
  });

  it("requires TIDAL credentials without treating the provider as policy-disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(collectCatalogMetadata("https://tidal.com/browse/track/12345")).rejects.toThrow("TIDAL client credentials are required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls TIDAL catalogue endpoints when credentials exist without a provider enable flag", async () => {
    process.env.TIDAL_CLIENT_ID = "test-client";
    process.env.TIDAL_CLIENT_SECRET = "test-secret";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("auth.tidal.com/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "test-tidal-token", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("openapi.tidal.com/v2/tracks/")) {
        return new Response(JSON.stringify({
          data: { type: "tracks", id: "12345", attributes: { title: "TIDAL Approved Track", releaseDate: "2025-08-27" }, relationships: { artists: { data: [{ id: "artist-1" }] } } },
          included: [{ type: "artists", id: "artist-1", attributes: { name: "TIDAL Approved Artist" } }],
        }), { status: 200 });
      }
      throw new Error("Unexpected TIDAL request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ platform: "tidal", title: "TIDAL Approved Track", artist: "TIDAL Approved Artist", evidenceStatus: "recognized" });
    expect(result.raw).not.toHaveProperty("providerPolicy");
  });
});
