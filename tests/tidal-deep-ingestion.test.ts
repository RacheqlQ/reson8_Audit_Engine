import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("TIDAL commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TIDAL_CLIENT_ID;
    delete process.env.TIDAL_CLIENT_SECRET;
  });

  it("reports TIDAL as not configured when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platform: "tidal",
      catalogId: "12345",
      raw: { providerPolicy: {
        provider: "tidal",
        status: "unavailable",
        reason: "not_configured",
        commercialStatus: "allowed",
      } },
    });
  });

  it("does not call TIDAL when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://tidal.com/browse/track/12345");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toMatchObject({ reason: "not_configured" });
  });
});
