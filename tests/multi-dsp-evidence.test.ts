import { describe, expect, it } from "vitest";
import { reconcileMetadata } from "../src/metadata/ReconciliationEngine.js";

describe("five-platform DSP evidence fixture", () => {
  it("retains five provider claims and flags the one conflicting identity field", () => {
    const result = reconcileMetadata({
      spotify: { title: "Free Mind", artist: "Tems", album: "For Broken Ears", isrc: "NGABC2000001" },
      apple_music: { title: "Free Mind", artist: "Tems", album: "For Broken Ears", isrc: "NGABC2000001" },
      deezer: { title: "Free Mind", artist: "Tems", album: "For Broken Ears", isrc: "NGABC2000001" },
      tidal: { title: "Free Mind", artist: "Wrong Artist", album: "For Broken Ears", isrc: "NGABC2000001" },
      youtube_music: { title: "Free Mind", artist: "Tems", album: "For Broken Ears", isrc: "NGABC2000001" },
    });

    expect(result.status).toBe("conflict");
    expect(result.identity.sourceProviders).toEqual(["spotify", "tidal", "apple_music", "deezer", "youtube_music"]);
    expect(result.conflicts).toEqual([{ field: "artist", values: ["Tems", "Wrong Artist"] }]);
    expect(result.identity.artist).toBe("Tems");
    expect(result.reconciledFields).toContain("title");
    expect(result.reconciledFields).toContain("isrc");
  });
});
