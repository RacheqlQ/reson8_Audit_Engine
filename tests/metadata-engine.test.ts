import { describe, expect, it } from "vitest";
import { MetadataEngine, type MetadataEngineInput } from "../src/metadata/MetadataEngine.js";

describe("MetadataEngine", () => {
  it("resolves DSP metadata first, then AudD, then ID3, then filename", () => {
    const input: MetadataEngineInput = {
      spotify: {
        title: "Dock of the Bay",
        artist: "Otis Redding",
        album: "The Dock of the Bay",
        isrc: "US-AT2-66-00001",
        label: "Volt",
        releaseDate: "1968-07-01",
        genres: ["Soul"],
      },
      tidal: { title: "Wrong Title", artist: "Wrong Artist" },
      audd: { result: { title: "AudD Title", artist: "AudD Artist", album: "AudD Album" } },
      id3: { title: "ID3 Title", artist: "ID3 Artist", album: "ID3 Album" },
      filename: "Fallback Artist - Fallback Title.mp3",
    };

    const identity = MetadataEngine.normalize(input);

    expect(identity).toMatchObject({
      title: "Dock of the Bay",
      artist: "Otis Redding",
      album: "The Dock of the Bay",
      isrc: "USAT26600001",
      label: "Volt",
      releaseDate: "1968-07-01",
      genres: ["Soul"],
      sourceProviders: ["spotify", "tidal", "audd", "id3"],
    });
  });

  it("uses lower-priority providers to fill missing fields without inventing values", () => {
    const input: MetadataEngineInput = {
      spotify: { title: "Known Title", artist: "Known Artist" },
      audd: {
        result: {
          title: "AudD Title",
          artist: "AudD Artist",
          album: "Recognized Album",
          isrc: "GB-ABC-12-34567",
          label: "Recognized Label",
        },
      },
      id3: { releaseDate: "1990-01-02", genres: ["Soul", "R&B"] },
    };

    const identity = MetadataEngine.normalize(input);

    expect(identity.title).toBe("Known Title");
    expect(identity.artist).toBe("Known Artist");
    expect(identity.album).toBe("Recognized Album");
    expect(identity.isrc).toBe("GBABC1234567");
    expect(identity.label).toBe("Recognized Label");
    expect(identity.releaseDate).toBe("1990-01-02");
    expect(identity.genres).toEqual(["Soul", "R&B"]);
  });

  it("falls back to filename for title and artist when no structured metadata exists", () => {
    const identity = MetadataEngine.normalize({
      filename: "(Sittin' On) the Dock of the Bay - Mono.mp3",
    });

    expect(identity.title).toBe("(Sittin' On) the Dock of the Bay - Mono");
    expect(identity.artist).toBeNull();
    expect(identity.sourceProviders).toEqual([]);
  });

  it("uses filename artist/title parsing only when structured providers do not supply them", () => {
    const identity = MetadataEngine.normalize({
      id3: { album: "Album Only" },
      filename: "Otis Redding - Dock of the Bay.mp3",
    });

    expect(identity.artist).toBe("Otis Redding");
    expect(identity.title).toBe("Dock of the Bay");
    expect(identity.album).toBe("Album Only");
    expect(identity.sourceProviders).toEqual(["id3"]);
  });

  it("ignores AudD metadata explicitly marked unmatched", () => {
    const identity = MetadataEngine.normalize({
      audd: { matched: false, title: "Fabricated Title", artist: "Fabricated Artist" },
    });

    expect(identity.title).toBeNull();
    expect(identity.artist).toBeNull();
    expect(identity.sourceProviders).toEqual([]);
  });

  it("ignores placeholders and produces an immutable identity", () => {
    const identity = MetadataEngine.normalize({
      spotify: { title: "Not available", artist: "N/A" },
      audd: { result: { title: "", artist: null } },
      filename: "Otis Redding - Dock of the Bay.wav",
    });

    expect(identity.title).toBe("Dock of the Bay");
    expect(identity.artist).toBe("Otis Redding");
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.genres)).toBe(true);
    expect(Object.isFrozen(identity.sourceProviders)).toBe(true);
  });
});
