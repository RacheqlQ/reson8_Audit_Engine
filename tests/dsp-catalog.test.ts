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

  it("does not misclassify generic YouTube video links as YouTube Music catalogue links", async () => {
    await expect(collectCatalogMetadata("https://www.youtube.com/watch?v=abc"))
      .rejects.toThrow("Unsupported DSP or catalog URL");
    await expect(collectCatalogMetadata("https://youtu.be/abc"))
      .rejects.toThrow("Unsupported DSP or catalog URL");
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

describe("catalogue policy gate coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call unverified Deezer but allows the approved Apple lookup without opt-in flags", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ resultCount: 1, results: [{ kind: "song", trackId: 67890, trackName: "Approved Track", artistName: "Approved Artist" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const apple = await collectCatalogMetadata("https://music.apple.com/us/album/song/12345?i=67890");
    const deezer = await collectCatalogMetadata("https://www.deezer.com/track/98765");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(apple.title).toBe("Approved Track");
    expect(deezer.raw.providerPolicy).toMatchObject({ provider: "deezer", reason: "disabled by data policy", commercialStatus: "unverified" });
  });

  it("extracts Apple Music track identity fields without a provider enable flag", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("itunes.apple.com/lookup?id=67890&entity=song&country=ng");
      return new Response(JSON.stringify({
      resultCount: 1,
      results: [{
        kind: "song",
        trackId: 67890,
        trackName: "Test Track",
        artistName: "Test Artist",
        collectionName: "Test Album",
        releaseDate: "2025-08-27T00:00:00Z",
        primaryGenreName: "R&B",
        trackViewUrl: "https://music.apple.com/us/album/test-track/12345?i=67890",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://music.apple.com/ng/album/test-album/12345?i=67890");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      platform: "apple_music",
      catalogId: "67890",
      artist: "Test Artist",
      title: "Test Track",
      album: "Test Album",
      releaseDate: "2025-08-27",
      evidenceStatus: "recognized",
    });
  });
});

describe("Audiomack commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUDIOMACK_CONSUMER_KEY;
    delete process.env.AUDIOMACK_CONSUMER_SECRET;
  });

  it("requires Audiomack credentials but does not require a separate enable flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(collectCatalogMetadata("https://audiomack.com/artist/song/track-title")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });


});


describe("Apple Music direct-song catalog lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts direct song IDs from geo links and queries the submitted storefront", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("itunes.apple.com/lookup?id=1234567890&entity=song&country=ng");
      return new Response(JSON.stringify({
        resultCount: 1,
        results: [{ kind: "song", trackId: 1234567890, trackName: "Direct Song", artistName: "Test Artist" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://geo.music.apple.com/ng/song/example-track/1234567890");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ platform: "apple_music", catalogId: "1234567890", title: "Direct Song", artist: "Test Artist" });
  });

  it("recognizes geo links and performs approved Apple lookup without an enable flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resultCount: 1, results: [{ kind: "song", trackId: 1234567890, trackName: "Geo Song", artistName: "Geo Artist" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCatalogMetadata("https://geo.music.apple.com/gb/song/example-track/1234567890");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(detectDspPlatform("https://geo.music.apple.com/gb/song/example-track/1234567890")).toBe("apple_music");
    expect(result.catalogId).toBe("1234567890");
  });
});
