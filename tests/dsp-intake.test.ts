import { describe, expect, it } from "vitest";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";
import { detectTrackPlatform } from "../public/dsp-url.js";

describe("multi-DSP track-link intake", () => {
  it("accepts up to eight supported single-track links and canonicalizes tracking variants", () => {
    const links = normalizeDspTrackLinks([
      "https://open.spotify.com/track/spotify-1?si=campaign",
      "https://music.apple.com/us/album/song/12345?i=67890&at=campaign",
      "https://www.deezer.com/track/deezer-1?utm_source=campaign",
      "https://tidal.com/browse/track/tidal-1?u=campaign",
      "https://audiomack.com/artist/song/track-title?ref=campaign",
      "https://music.youtube.com/watch?v=youtube-1&feature=share",
    ]);

    expect(links).toEqual([
      { platform: "spotify", catalogId: "spotify-1", canonicalUrl: "https://open.spotify.com/track/spotify-1" },
      { platform: "apple_music", catalogId: "67890", canonicalUrl: "https://music.apple.com/us/album/song/12345?i=67890" },
      { platform: "deezer", catalogId: "deezer-1", canonicalUrl: "https://www.deezer.com/track/deezer-1" },
      { platform: "tidal", catalogId: "tidal-1", canonicalUrl: "https://tidal.com/browse/track/tidal-1" },
      { platform: "audiomack", catalogId: "artist/track-title", canonicalUrl: "https://audiomack.com/artist/song/track-title" },
      { platform: "youtube_music", catalogId: "youtube-1", canonicalUrl: "https://music.youtube.com/watch?v=youtube-1" },
    ]);
  });

  it("deduplicates by platform and canonical track ID while preserving first-seen order", () => {
    const links = normalizeDspTrackLinks([
      "https://open.spotify.com/track/abc?si=one",
      "https://open.spotify.com/track/abc?si=two",
      "https://www.deezer.com/track/def",
    ]);
    expect(links.map((link) => link.catalogId)).toEqual(["abc", "def"]);
  });

  it("rejects two distinct tracks from the same DSP to prevent cross-track reconciliation", () => {
    expect(() => normalizeDspTrackLinks([
      "https://open.spotify.com/track/track-one",
      "https://open.spotify.com/track/track-two",
    ])).toThrow("Only one distinct track per DSP platform is allowed in a single audit");
  });

  it("preserves case-sensitive Spotify and YouTube Music identifiers during deduplication", () => {
    const spotifyUpper = normalizeDspTrackLinks(["https://open.spotify.com/track/AbCd"])[0];
    const spotifyLower = normalizeDspTrackLinks(["https://open.spotify.com/track/abcd"])[0];
    const youtubeUpper = normalizeDspTrackLinks(["https://music.youtube.com/watch?v=AbCd"])[0];
    const youtubeLower = normalizeDspTrackLinks(["https://music.youtube.com/watch?v=abcd"])[0];
    expect(spotifyUpper?.catalogId).not.toBe(spotifyLower?.catalogId);
    expect(youtubeUpper?.catalogId).not.toBe(youtubeLower?.catalogId);
  });

  it.each([
    "https://www.youtube.com/watch?v=generic-video",
    "https://youtube.com/watch?v=generic-video",
    "https://youtu.be/generic-video",
    "https://www.youtube.com/shorts/generic-video",
  ])("rejects generic YouTube video URL at intake: %s", (url) => {
    expect(() => normalizeDspTrackLinks([url])).toThrow("Unsupported DSP or catalog URL");
  });

  it("rejects more than eight submitted links before provider work", () => {
    const links = Array.from({ length: 9 }, (_, index) => `https://open.spotify.com/track/track-${index}`);
    expect(() => normalizeDspTrackLinks(links)).toThrow("A maximum of 8 DSP track links is allowed");
  });

  it.each([
    "http://open.spotify.com/track/abc",
    "https://open.spotify.com.evil.example/track/abc",
    "https://open.spotify.com:8443/track/abc",
    "https://127.0.0.1/track/abc",
    "https://localhost/track/abc",
    "https://user:pass@open.spotify.com/track/abc",
    "https://example.com/track/abc",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(() => normalizeDspTrackLinks([url])).toThrow();
  });

  it.each([
    "https://open.spotify.com/playlist/abc",

    "https://www.deezer.com/album/123",
    "https://tidal.com/playlist/123",
    "https://music.youtube.com/channel/channel-1",
    "https://audiomack.com/artist/playlist/playlist-title",
  ])("rejects non-track catalog URL %s", (url) => {
    expect(() => normalizeDspTrackLinks([url])).toThrow("Only individual DSP track links are supported");
  });

  it("rejects an empty submission", () => {
    expect(() => normalizeDspTrackLinks([])).toThrow("Provide at least one DSP track link");
  });
});


describe("Apple Music regional and direct-song URL intake", () => {
  it("accepts direct song URLs in the browser and server validators", () => {
    const url = "https://music.apple.com/ng/song/example-track/1234567890";
    expect(detectTrackPlatform(url)).toBe("Apple Music");
    expect(normalizeDspTrackLinks([url])).toEqual([{
      platform: "apple_music",
      catalogId: "1234567890",
      canonicalUrl: url
    }]);
  });

  it("accepts geo.music.apple.com and legacy iTunes track share links", () => {
    const geo = "https://geo.music.apple.com/gb/song/example-track/1234567890";
    const itunes = "https://itunes.apple.com/gb/song/example-track/1234567890";
    expect(detectTrackPlatform(geo)).toBe("Apple Music");
    expect(detectTrackPlatform(itunes)).toBe("Apple Music");
    expect(normalizeDspTrackLinks([geo])[0]).toMatchObject({ platform: "apple_music", catalogId: "1234567890" });
    expect(normalizeDspTrackLinks([itunes])[0]).toMatchObject({ platform: "apple_music", catalogId: "1234567890" });
  });

  it("accepts regional album links only when a numeric track query is present", () => {
    const link = normalizeDspTrackLinks(["https://geo.music.apple.com/ng/album/example-album/12345?i=67890&at=share"])[0];
    expect(link).toEqual({
      platform: "apple_music",
      catalogId: "67890",
      canonicalUrl: "https://music.apple.com/ng/album/example-album/12345?i=67890"
    });
    expect(() => normalizeDspTrackLinks(["https://music.apple.com/ng/album/example-album/12345"]))
      .toThrow(/track-specific/i);
    expect(() => detectTrackPlatform("https://music.apple.com/ng/album/example-album/12345"))
      .toThrow(/track-specific/i);
  });

  it.each([
    "https://music.apple.com/ng/song/example-track/not-numeric",
    "https://music.apple.com/ng/song/example-track/12345?i=67890",
    "https://geo.music.apple.com.evil.example/ng/song/example-track/1234567890",
    "https://music.apple.com:8443/ng/song/example-track/1234567890",
    "http://music.apple.com/ng/song/example-track/1234567890"
  ])("rejects malformed IDs or unsafe Apple Music hosts: %s", (url) => {
    expect(() => normalizeDspTrackLinks([url])).toThrow();
    expect(() => detectTrackPlatform(url)).toThrow();
  });

  it("preserves country query storefronts when a share URL omits the storefront path", () => {
    const url = "https://geo.music.apple.com/song/example-track/1234567890?country=ng";
    expect(normalizeDspTrackLinks([url])[0]).toEqual({
      platform: "apple_music",
      catalogId: "1234567890",
      canonicalUrl: "https://music.apple.com/ng/song/example-track/1234567890"
    });
  });
});
