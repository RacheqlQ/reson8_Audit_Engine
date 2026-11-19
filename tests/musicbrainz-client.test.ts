import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBrainzClient, normalizeIsrc } from "../src/providers/musicbrainz/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MusicBrainz ISRC catalogue client", () => {
  it("normalizes valid ISRCs and rejects malformed identifiers", () => {
    expect(normalizeIsrc("GB-AYE-12-12345")).toBe("GBAYE1212345");
    expect(normalizeIsrc("usabc2300001")).toBe("USABC2300001");
    expect(() => normalizeIsrc("not-an-isrc")).toThrow(/valid ISRC/i);
  });

  it("resolves an ISRC to recording identity and release label evidence", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recordings: [{
        id: "recording-mbid",
        title: "Example Track",
        "artist-credit": [{ name: "Example Artist" }],
        releases: [{
          id: "release-mbid",
          title: "Example EP",
          date: "2024-03-01",
          "label-info": [{ label: { name: "Example Records" } }],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MusicBrainzClient().lookupIsrc("GB-AYE-12-12345");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe("/ws/2/isrc/GBAYE1212345");
    expect(requestedUrl.searchParams.get("inc")).toContain("recordings");
    expect(requestedUrl.searchParams.get("fmt")).toBe("json");
    expect(result).toEqual([{
      recordingId: "recording-mbid",
      title: "Example Track",
      artist: "Example Artist",
      releases: [{
        releaseId: "release-mbid",
        title: "Example EP",
        date: "2024-03-01",
        label: "Example Records",
      }],
      source: "musicbrainz",
    }]);
  });

  it("returns an empty result for a valid ISRC with no recording match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recordings: [] }), { status: 200 })));
    await expect(new MusicBrainzClient().lookupIsrc("GBAYE1212345")).resolves.toEqual([]);
  });

  it("fails closed on HTTP errors and never treats provider errors as empty matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(new MusicBrainzClient().lookupIsrc("GBAYE1212345")).rejects.toThrow(/HTTP 503/);
  });
});
