import { describe, expect, it } from "vitest";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

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

  it("preserves case-sensitive Spotify and YouTube identifiers during deduplication", () => {
    const spotifyUpper = normalizeDspTrackLinks(["https://open.spotify.com/track/AbCd"])[0];
    const spotifyLower = normalizeDspTrackLinks(["https://open.spotify.com/track/abcd"])[0];
    const youtubeUpper = normalizeDspTrackLinks(["https://www.youtube.com/watch?v=AbCd"])[0];
    const youtubeLower = normalizeDspTrackLinks(["https://www.youtube.com/watch?v=abcd"])[0];
    expect(spotifyUpper?.catalogId).not.toBe(spotifyLower?.catalogId);
    expect(youtubeUpper?.catalogId).not.toBe(youtubeLower?.catalogId);
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
    "https://music.apple.com/us/album/album-name/123",
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
