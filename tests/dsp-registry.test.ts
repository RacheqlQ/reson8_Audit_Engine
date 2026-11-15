import { describe, expect, it, vi } from "vitest";
import type { CatalogMetadata } from "../src/providers/dsp/catalog.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";

const link = (platform: "spotify" | "tidal", catalogId: string) => ({
  platform, catalogId, canonicalUrl: `https://example.test/${catalogId}`,
});

const metadata = (platform: "spotify" | "tidal", catalogId: string): CatalogMetadata => ({
  platform, sourceUrl: `https://example.test/${catalogId}`, canonicalUrl: `https://example.test/${catalogId}`,
  catalogId, artist: "Artist", title: catalogId, album: null, releaseDate: null, isrc: null, upc: null,
  catalogPopularity: null, catalogPopularityScale: null, label: null, genre: null, artworkUrl: null,
  previewUrl: null, externalIds: {}, sonicProfile: null, raw: {}, evidenceStatus: "recognized",
});

describe("DSP provider registry", () => {
  it("looks up links sequentially in submitted order and records provider provenance", async () => {
    const order: string[] = [];
    const results = await collectDspMetadata([link("spotify", "one"), link("tidal", "two")], {
      collect: async (url) => {
        order.push(url);
        return metadata(url.endsWith("one") ? "spotify" : "tidal", url.split("/").at(-1)!);
      },
    });

    expect(order).toEqual(["https://example.test/one", "https://example.test/two"]);
    expect(results.map((result) => result.metadata?.platform)).toEqual(["spotify", "tidal"]);
    expect(results.every((result) => result.status === "recognized")).toBe(true);
  });

  it("isolates provider failures and continues with the remaining providers", async () => {
    const results = await collectDspMetadata([link("spotify", "one"), link("tidal", "two")], {
      collect: async (url) => {
        if (url.endsWith("one")) throw new Error("provider unavailable");
        return metadata("tidal", "two");
      },
    });

    expect(results[0]).toMatchObject({ status: "unavailable", error: "provider unavailable" });
    expect(results[1]).toMatchObject({ status: "recognized", metadata: { catalogId: "two" } });
  });

  it("bounds each provider lookup and records a timeout without aborting later sources", async () => {
    const results = await collectDspMetadata([link("spotify", "slow"), link("tidal", "fast")], {
      timeoutMs: 5,
      collect: vi.fn(async (url, signal) => {
        if (url.endsWith("slow")) {
          return await new Promise<CatalogMetadata>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        return metadata("tidal", "fast");
      }),
    });

    expect(results[0].status).toBe("unavailable");
    expect(results[0].error).toMatch(/timed out/i);
    expect(results[1].status).toBe("recognized");
  });
});
