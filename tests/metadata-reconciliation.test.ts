import { describe, expect, it } from "vitest";
import { reconcileMetadata } from "../src/metadata/ReconciliationEngine.js";

describe("Metadata reconciliation", () => {
  it("marks matching independent provider identity as reconciled", () => {
    const result = reconcileMetadata({
      spotify: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
        album: "The Dock of the Bay",
        isrc: "USAT26600001",
      },
      tidal: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
        album: "The Dock of the Bay",
        isrc: "US-AT2-66-00001",
      },
      audd: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
        isrc: "USAT26600001",
      },
    });

    expect(result.status).toBe("reconciled");
    expect(result.identity).toMatchObject({
      title: "Dock of the Bay",
      artist: "Otis Redding",
      album: "The Dock of the Bay",
      isrc: "USAT26600001",
    });
    expect(result.reconciledFields).toEqual([
      "title",
      "artist",
      "album",
      "isrc",
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("reconciles MusicBrainz ISRC metadata with an independent DSP source", () => {
    const result = reconcileMetadata({
      musicbrainz: {
        title: "Free Mind",
        artist: "Tems",
        isrc: "NGABC2000001",
      },
      tidal: {
        title: "Free Mind",
        artist: "Tems",
        isrc: "NG-ABC-20-00001",
      },
    });

    expect(result.status).toBe("reconciled");
    expect(result.reconciledFields).toEqual(["title", "artist", "isrc"]);
    expect(result.identity.sourceProviders).toEqual(["musicbrainz", "tidal"]);
    expect(result.identity.fieldProvenance).toMatchObject({
      title: "musicbrainz",
      artist: "musicbrainz",
      isrc: "musicbrainz",
    });
  });

  it("does not call conflicting provider claims reconciled", () => {
    const result = reconcileMetadata({
      spotify: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
        isrc: "USAT26600001",
      },
      tidal: {
        title: "Wrong Track",
        artist: "Wrong Artist",
        isrc: "USAT26600002",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toEqual([
      { field: "title", values: ["Dock of the Bay", "Wrong Track"] },
      { field: "artist", values: ["Otis Redding", "Wrong Artist"] },
      { field: "isrc", values: ["USAT26600001", "USAT26600002"] },
    ]);
    expect(result.identity.title).toBe("Dock of the Bay");
    expect(result.identity.artist).toBe("Otis Redding");
    expect(result.identity.isrc).toBe("USAT26600001");
  });

  it("reconciles Apple Music, Deezer and YouTube Music as named independent DSP sources", () => {
    const result = reconcileMetadata({
      apple_music: { title: "Free Mind", artist: "Tems", isrc: "NGABC2000001" },
      deezer: { title: "Free Mind", artist: "Tems", isrc: "NGABC2000001" },
      youtube_music: { title: "Free Mind", artist: "Tems", isrc: "NGABC2000001" },
    });

    expect(result.status).toBe("reconciled");
    expect(result.reconciledFields).toEqual(["title", "artist", "isrc"]);
    expect(result.identity.sourceProviders).toEqual(["apple_music", "deezer", "youtube_music"]);
  });

  it("ignores metadata attached to an explicitly unmatched AudD response", () => {
    const result = reconcileMetadata({
      spotify: { title: "Verified Catalog Title", artist: "Catalog Artist" },
      audd: { matched: false, result: { title: "False Match", artist: "Wrong Artist" } },
    });

    expect(result.status).toBe("partial");
    expect(result.conflicts).toEqual([]);
    expect(result.identity.title).toBe("Verified Catalog Title");
    expect(result.identity.sourceProviders).toEqual(["spotify"]);
  });

  it("treats a single provider as recognized metadata, not reconciliation", () => {
    const result = reconcileMetadata({
      tidal: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
      },
    });

    expect(result.status).toBe("partial");
    expect(result.reconciledFields).toEqual([]);
    expect(result.identity).toMatchObject({
      title: "Dock of the Bay",
      artist: "Otis Redding",
    });
  });

  it("ignores malformed ISRC claims instead of reconciling or conflicting on them", () => {
    const result = reconcileMetadata({
      musicbrainz: { title: "Example Track", isrc: "not-an-isrc" },
      tidal: { title: "Example Track", isrc: "also-invalid" },
    });

    expect(result.status).toBe("reconciled");
    expect(result.reconciledFields).toEqual(["title"]);
    expect(result.conflicts).toEqual([]);
    expect(result.identity.isrc).toBeNull();
    expect(result.identity.fieldProvenance.isrc).toBeNull();
  });
});
