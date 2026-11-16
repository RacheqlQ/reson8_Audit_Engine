import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("TIDAL commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TIDAL_CLIENT_ID;
    delete process.env.TIDAL_CLIENT_SECRET;
    delete process.env.PROVIDER_ENABLED_TIDAL;
  });

  it("does not call TIDAL when credentials are present but exact opt-in is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.TIDAL_CLIENT_ID = "client-id";
    process.env.TIDAL_CLIENT_SECRET = "client-secret";

    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platform: "tidal",
      catalogId: "12345",
      raw: { providerPolicy: {
        provider: "tidal",
        status: "unavailable",
        reason: "disabled by data policy",
        commercialStatus: "allowed",
      } },
    });
  });

  it("does not call TIDAL when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toMatchObject({ reason: "disabled by data policy" });
  });
});
