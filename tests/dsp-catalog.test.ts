import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCatalogMetadata, detectDspPlatform } from "../src/providers/dsp/catalog.js";

describe("DSP catalog URL detection", () => {
  it("detects supported track hosts", () => {
    expect(detectDspPlatform("https://open.spotify.com/track/123")).toBe("spotify");
    expect(detectDspPlatform("https://music.apple.com/us/album/x/1?i=2")).toBe("apple_music");
    expect(detectDspPlatform("https://music.youtube.com/watch?v=abc")).toBe("youtube_music");
    expect(detectDspPlatform("https://www.youtube.com/watch?v=abc")).toBe("unknown");
    expect(detectDspPlatform("https://youtu.be/abc")).toBe("unknown");
    expect(detectDspPlatform("https://www.deezer.com/track/123")).toBe("deezer");
    expect(detectDspPlatform("https://tidal.com/browse/track/123")).toBe("tidal");
    expect(detectDspPlatform("https://audiomack.com/artist/song/track-title")).toBe("audiomack");
  });

  it("rejects unsupported or unsafe URLs and TIDAL playlists", async () => {
    expect(detectDspPlatform("http://open.spotify.com/track/123")).toBe("unknown");
    expect(detectDspPlatform("https://example.com/track/123")).toBe("unknown");
    expect(detectDspPlatform("https://user:pass@open.spotify.com/track/123")).toBe("unknown");
    await expect(collectCatalogMetadata("https://www.youtube.com/watch?v=abc")).rejects.toThrow("Unsupported DSP or catalog URL");
    await expect(collectCatalogMetadata("https://tidal.com/playlist/406948b1-a8d4-493d-9672-90df47580540"))
      .rejects.toThrow("TIDAL playlist URLs are not supported for single-track audits");
  });
});

describe("authorized catalogue calls without per-provider opt-in flags", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUDIOMACK_CONSUMER_KEY;
    delete process.env.AUDIOMACK_CONSUMER_SECRET;
  });

  it("calls Apple Music, YouTube Music oEmbed and Deezer when their implemented public endpoints are available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("itunes.apple.com/lookup")) {
        return new Response(JSON.stringify({ resultCount: 1, results: [{ kind: "song", trackId: 67890, trackName: "Apple Track", artistName: "Apple Artist" }] }), { status: 200 });
      }
      if (url.includes("youtube.com/oembed")) {
        return new Response(JSON.stringify({ title: "YouTube Music Track", author_name: "YouTube Artist" }), { status: 200 });
      }
      if (url.includes("api.deezer.com/track/")) {
        return new Response(JSON.stringify({ id: 98765, title: "Deezer Track", artist: { name: "Deezer Artist" }, album: { title: "Deezer Album" }, link: "https://www.deezer.com/track/98765" }), { status: 200 });
      }
      throw new Error("Unexpected catalogue request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const apple = await collectCatalogMetadata("https://music.apple.com/ng/album/song/12345?i=67890");
    const youtube = await collectCatalogMetadata("https://music.youtube.com/watch?v=youtube-123");
    const deezer = await collectCatalogMetadata("https://www.deezer.com/track/98765");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(apple).toMatchObject({ platform: "apple_music", title: "Apple Track", artist: "Apple Artist", evidenceStatus: "recognized" });
    expect(youtube).toMatchObject({ platform: "youtube_music", title: "YouTube Music Track", artist: "YouTube Artist", evidenceStatus: "recognized" });
    expect(deezer).toMatchObject({ platform: "deezer", title: "Deezer Track", artist: "Deezer Artist", evidenceStatus: "recognized" });
    for (const result of [apple, youtube, deezer]) expect(result.raw).not.toHaveProperty("providerPolicy");
  });

  it("calls Audiomack official signed Data API with credentials and no provider enable flag", async () => {
    process.env.AUDIOMACK_CONSUMER_KEY = "consumer-key";
    process.env.AUDIOMACK_CONSUMER_SECRET = "consumer-secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: {
      id: "audiomack-123", type: "song", title: "Audiomack Track", artist: "Audiomack Artist",
      album: "Audiomack Album", genre: "Afrobeats", uploader: { name: "Audiomack Artist" },
    } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://audiomack.com/artist/song/track-title");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toContain("OAuth ");
    expect(result).toMatchObject({ platform: "audiomack", title: "Audiomack Track", artist: "Audiomack Artist", evidenceStatus: "recognized" });
    expect(result.raw).not.toHaveProperty("providerPolicy");
  });

  it("reports missing Audiomack credentials as configuration, not policy denial", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(collectCatalogMetadata("https://audiomack.com/artist/song/track-title"))
      .rejects.toThrow("Audiomack official API credentials are not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
