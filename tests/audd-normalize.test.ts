import { describe, expect, it } from "vitest";
import { normalizeAuddRecognition } from "../src/providers/audd/normalize.js";

describe("normalizeAuddRecognition", () => {
  it("normalizes a matched AudD result into the audit engine evidence shape", () => {
    const result = normalizeAuddRecognition({
      artist: "Tems",
      title: "Free Mind",
      album: "For Broken Ears",
      release_date: "2020-10-01",
      label: "Leading Vibe",
      song_link: "https://audd.tech/track",
      timecode: "00:07",
      spotify: { external_urls: { spotify: "https://open.spotify.com/track/example" } },
      apple_music: { url: "https://music.apple.com/ng/song/example" },
    });

    expect(result).toEqual({
      matched: true,
      artist: "Tems",
      title: "Free Mind",
      album: "For Broken Ears",
      releaseDate: "2020-10-01",
      label: "Leading Vibe",
      songLink: "https://audd.tech/track",
      timecode: "00:07",
      spotifyUrl: "https://open.spotify.com/track/example",
      appleMusicUrl: "https://music.apple.com/ng/song/example",
      rawResponse: {
        artist: "Tems", title: "Free Mind", album: "For Broken Ears",
        release_date: "2020-10-01", label: "Leading Vibe",
        song_link: "https://audd.tech/track", timecode: "00:07",
        spotify: { external_urls: { spotify: "https://open.spotify.com/track/example" } },
        apple_music: { url: "https://music.apple.com/ng/song/example" },
      },
    });
  });

  it("returns an explicit unmatched result instead of inventing metadata", () => {
    expect(normalizeAuddRecognition(null)).toEqual({ matched: false });
    expect(normalizeAuddRecognition({})).toEqual({ matched: false });
    expect(normalizeAuddRecognition({ artist: " ", title: null })).toEqual({ matched: false });
  });
});


it("preserves provider identifiers needed for reconciliation", () => {
  const result = normalizeAuddRecognition({
    artist: "Artist",
    title: "Song",
    spotify: { external_urls: { spotify: "https://open.spotify.com/track/abc" } },
    apple_music: { url: "https://music.apple.com/us/song/123" },
    musicbrainz_id: "mbid", score: 0.18, provider_extension: "preserved",
  } as never);

  expect(result).toMatchObject({
    matched: true,
    spotifyUrl: "https://open.spotify.com/track/abc",
    appleMusicUrl: "https://music.apple.com/us/song/123",
    rawResponse: expect.objectContaining({ score: 0.18, provider_extension: "preserved" }),
  });
  expect(result.matched && "confidence" in result).toBe(false);
});
