import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata, detectDspPlatform } from "../src/providers/dsp/catalog.js";

describe("DSP catalog URL detection", () => {
  it("detects supported track hosts", () => {
    expect(detectDspPlatform("https://open.spotify.com/track/123")).toBe("spotify");
    expect(detectDspPlatform("https://music.apple.com/us/album/x/1?i=2")).toBe("apple_music");
    expect(detectDspPlatform("https://www.youtube.com/watch?v=abc")).toBe("youtube_music");
    expect(detectDspPlatform("https://www.deezer.com/track/123")).toBe("deezer");
    expect(detectDspPlatform("https://tidal.com/browse/track/123")).toBe("tidal");
    expect(detectDspPlatform("https://audiomack.com/artist/song/track-title")).toBe("audiomack");
  });

  it("rejects unsupported or unsafe URLs", () => {
    expect(detectDspPlatform("http://open.spotify.com/track/123")).toBe("unknown");
    expect(detectDspPlatform("https://example.com/track/123")).toBe("unknown");
    expect(detectDspPlatform("https://user:pass@open.spotify.com/track/123")).toBe("unknown");
  });

  it("reports TIDAL playlist URLs as unsupported for single-track audits", async () => {
    await expect(
      collectCatalogMetadata("https://tidal.com/playlist/406948b1-a8d4-493d-9672-90df47580540"),
    ).rejects.toThrow("TIDAL playlist URLs are not supported for single-track audits");
  });
});

describe("Audiomack official metadata API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUDIOMACK_CONSUMER_KEY;
    delete process.env.AUDIOMACK_CONSUMER_SECRET;
  });

  it("uses the official OAuth-signed metadata endpoint without scraping or playback metrics", async () => {
    process.env.AUDIOMACK_CONSUMER_KEY = "consumer-key";
    process.env.AUDIOMACK_CONSUMER_SECRET = "consumer-secret";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ results: {
        id: "162", type: "song", title: "Last in Class", artist: "Justa Test",
        genre: "Hip Hop / Rap", released: "1381525467", streaming_url: "https://songs.example/secret.mp3", play_count: 999,
        uploader: { name: "Justa Test", label: "Whatevz" },
      } }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://audiomack.com/justa-test/song/last-in-class");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/v1/music/song/justa-test/last-in-class");
    expect(new URL(String(url)).searchParams.get("fields")).toContain("uploader:name");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^OAuth /);
    expect(result).toMatchObject({
      platform: "audiomack", catalogId: "162", artist: "Justa Test", title: "Last in Class",
      genre: "Hip Hop / Rap", label: "Whatevz", evidenceStatus: "recognized",
    });
    expect(JSON.stringify(result.raw)).not.toMatch(/play_counter|event_counters|streaming_url/);
  });

  it("fails closed when official Audiomack API credentials are missing", async () => {
    await expect(collectCatalogMetadata("https://audiomack.com/artist/song/track-title"))
      .rejects.toThrow("Audiomack official API credentials are not configured");
  });
});
