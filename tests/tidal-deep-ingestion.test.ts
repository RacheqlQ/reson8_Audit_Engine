import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata } from "../src/providers/dsp/catalog.js";

describe("TIDAL provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TIDAL_CLIENT_ID;
    delete process.env.TIDAL_CLIENT_SECRET;
  });

  it("requires TIDAL credentials without a separate provider enable flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(collectCatalogMetadata("https://tidal.com/browse/track/12345")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
