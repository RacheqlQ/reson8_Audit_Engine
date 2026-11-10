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

  it("treats a single provider as observed metadata, not reconciliation", () => {
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
});
