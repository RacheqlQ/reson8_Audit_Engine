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
    delete process.env.PROVIDER_ENABLED_APPLE_MUSIC;
    delete process.env.PROVIDER_ENABLED_YOUTUBE_MUSIC;
    delete process.env.PROVIDER_ENABLED_DEEZER;
  });

  it("keeps Apple, YouTube Music and Deezer off by default without exact opt-in flags", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const urls = [
      "https://music.apple.com/us/album/song/12345?i=67890",
      "https://music.youtube.com/watch?v=youtube-123",
      "https://www.deezer.com/track/98765",
    ];
    const results = await Promise.all(urls.map((url) => collectCatalogMetadata(url)));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results.map((result) => result.raw.providerPolicy)).toMatchObject([
      { provider: "apple_music", reason: "disabled by data policy", commercialStatus: "allowed" },
      { provider: "youtube_music", reason: "disabled by data policy", commercialStatus: "allowed" },
      { provider: "deezer", reason: "disabled by data policy", commercialStatus: "allowed" },
    ]);
  });
});

describe("Audiomack commercial policy gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUDIOMACK_CONSUMER_KEY;
    delete process.env.AUDIOMACK_CONSUMER_SECRET;
    delete process.env.PROVIDER_ENABLED_AUDIOMACK;
  });

  it("does not call the official API when credentials are present but exact opt-in is absent", async () => {
    process.env.AUDIOMACK_CONSUMER_KEY = "consumer-key";
    process.env.AUDIOMACK_CONSUMER_SECRET = "consumer-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://audiomack.com/justa-test/song/last-in-class");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toMatchObject({
      provider: "audiomack",
      status: "unavailable",
      reason: "disabled by data policy",
      commercialStatus: "allowed",
    });
  });

  it("does not call the official API when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCatalogMetadata("https://audiomack.com/artist/song/track-title");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.raw.providerPolicy).toMatchObject({ reason: "disabled by data policy" });
  });
});
