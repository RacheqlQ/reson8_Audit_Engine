import { describe, expect, it } from "vitest";
import { buildSongEvidence } from "../src/jobs/song-evidence.js";

describe("Song Evidence Object", () => {
  it("does not treat identifiers nested in one AudD response as independent corroboration", () => {
    const evidence = buildSongEvidence({
      matched: true,
      artist: "Artist",
      title: "Song",
      isrc: "NGABC2600001",
      spotifyId: "track123",
      musicbrainzId: "recording123",
    });

    expect(evidence.status).toBe("partial");
    expect(evidence.confidence).toBeNull();
    expect(evidence.sources).toEqual(["audd"]);
  });

  it("does not assign an evidence source to an empty matched payload", () => {
    const evidence = buildSongEvidence({ matched: true });
    expect(evidence.status).toBe("unresolved");
    expect(evidence.sources).toEqual([]);
    expect(evidence.confidence).toBeNull();
  });

  it("keeps unmatched recordings explicitly unresolved", () => {
    const evidence = buildSongEvidence({ matched: false });
    expect(evidence.status).toBe("unresolved");
    expect(evidence.confidence).toBeNull();
  });
});
