import { describe, expect, it } from "vitest";
import { readAudioTags } from "../src/metadata/audio-tags.js";

function syncSafe(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}
function frame(id: string, value: string): number[] {
  const data = [3, ...new TextEncoder().encode(value)];
  return [...new TextEncoder().encode(id), ...[
    (data.length >> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255,
  ], 0, 0, ...data];
}
function id3(tags: Record<string, string>): Uint8Array {
  const map: Record<string, string> = { title: "TIT2", artist: "TPE1", album: "TALB", isrc: "TSRC", genre: "TCON", releaseDate: "TDRC", label: "TPUB" };
  const frames = Object.entries(tags).flatMap(([key, value]) => frame(map[key], value));
  return new Uint8Array([73,68,51,4,0,0,...syncSafe(frames.length),...frames]);
}


function flacComments(tags: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const comments = Object.entries(tags).map(([key, value]) => encoder.encode(key.toUpperCase() + "=" + value));
  const vendor = encoder.encode("Reson8 test fixture");
  const body: number[] = [...[vendor.length,0,0,0], ...vendor, ...[comments.length,0,0,0]];
  for (const comment of comments) body.push(comment.length & 255,(comment.length >> 8) & 255,(comment.length >> 16) & 255,(comment.length >> 24) & 255,...comment);
  return new Uint8Array([102,76,97,67,0x84,(body.length >> 16)&255,(body.length >> 8)&255,body.length&255,...body]);
}

describe("audio metadata tag extraction", () => {
  it("extracts ID3v2 title, artist, album, ISRC, genre, date and label", () => {
    expect(readAudioTags(id3({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genre: "Afrobeats", releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    }))).toEqual({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genres: ["Afrobeats"], releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    });
  });

  it("extracts Vorbis comments from FLAC masters", () => {
    expect(readAudioTags(flacComments({
      TITLE: "Bend Et", ARTIST: "Stunixx", ALBUM: "The HoleHearted",
      ISRC: "NGABC2600001", GENRE: "Afrobeats", DATE: "2025-08-27", LABEL: "BlackBeard Entertainment",
    }))).toMatchObject({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genres: ["Afrobeats"], releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    });
  });

  it("returns an empty structured result for files without recognized tags", () => {
    expect(readAudioTags(new TextEncoder().encode("not an ID3 file"))).toEqual({
      title: null, artist: null, album: null, isrc: null, genres: [], releaseDate: null, label: null,
    });
  });
});
