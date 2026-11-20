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


function id3v1({ genre = 17, track = null, comment = "" }: { genre?: number; track?: number | null; comment?: string } = {}): Uint8Array {
  const bytes = new Uint8Array(128);
  const write = (offset: number, length: number, value: string) => {
    bytes.set(new TextEncoder().encode(value).subarray(0, length), offset);
  };
  write(0, 3, "TAG");
  write(3, 30, "Legacy title");
  write(33, 30, "Legacy artist");
  write(63, 30, "Legacy album");
  write(93, 4, "1999");
  write(97, 30, comment);
  if (track !== null) {
    bytes[125] = 0;
    bytes[126] = track;
  }
  bytes[127] = genre;
  return bytes;
}

function wavInfo(tags: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const ids: Record<string, string> = { title: "INAM", artist: "IART", album: "IPRD", genre: "IGNR", releaseDate: "ICRD", label: "IPUB", isrc: "ISRC" };
  const info: number[] = [73,78,70,79];
  for (const [key, value] of Object.entries(tags)) {
    const data = [...encoder.encode(value), 0];
    info.push(...encoder.encode(ids[key]), data.length & 255, (data.length >> 8) & 255, (data.length >> 16) & 255, (data.length >> 24) & 255, ...data);
    if (data.length % 2) info.push(0);
  }
  const list = [...[76,73,83,84], info.length & 255, (info.length >> 8) & 255, (info.length >> 16) & 255, (info.length >> 24) & 255, ...info];
  const body = [...[87,65,86,69], ...list];
  return new Uint8Array([82,73,70,70, (body.length)&255, (body.length>>8)&255, (body.length>>16)&255, (body.length>>24)&255, ...body]);
}

function oggCommentPage(isrc: string, codec: "opus" | "vorbis" = "opus"): Uint8Array {
  const encoder = new TextEncoder();
  const prefix = codec === "opus" ? encoder.encode("OpusTags") : new Uint8Array([3, ...encoder.encode("vorbis")]);
  const vendor = encoder.encode("Reson8 test fixture");
  const comment = encoder.encode("ISRC=" + isrc);
  const packet: number[] = [...prefix, vendor.length & 255, (vendor.length >> 8) & 255, (vendor.length >> 16) & 255, (vendor.length >> 24) & 255, ...vendor,
    1, 0, 0, 0, comment.length & 255, (comment.length >> 8) & 255, (comment.length >> 16) & 255, (comment.length >> 24) & 255, ...comment];
  const lacing: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) { lacing.push(255); remaining -= 255; }
  lacing.push(remaining);
  const page = new Uint8Array(27 + lacing.length + packet.length);
  page.set(encoder.encode("OggS"), 0);
  page[4] = 0;
  page[5] = 2;
  page[26] = lacing.length;
  page.set(lacing, 27);
  page.set(packet, 27 + lacing.length);
  return page;
}

function mp4Atom(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  return bytes;
}
function mp4FreeformIsrc(value: string): Uint8Array {
  const encoder = new TextEncoder();
  const fullBox = new Uint8Array([0, 0, 0, 0]);
  const dataPrefix = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]);
  const mean = mp4Atom("mean", new Uint8Array([...fullBox, ...encoder.encode("com.apple.iTunes")]));
  const name = mp4Atom("name", new Uint8Array([...fullBox, ...encoder.encode("ISRC")]));
  const data = mp4Atom("data", new Uint8Array([...dataPrefix, ...encoder.encode(value)]));
  const item = mp4Atom("----", new Uint8Array([...mean, ...name, ...data]));
  const ilst = mp4Atom("ilst", item);
  const meta = mp4Atom("meta", new Uint8Array([...fullBox, ...ilst]));
  const udta = mp4Atom("udta", meta);
  const moov = mp4Atom("moov", udta);
  const ftyp = mp4Atom("ftyp", new Uint8Array([...encoder.encode("M4A "), 0, 0, 0, 0, ...encoder.encode("M4A "), ...encoder.encode("mp42")]));
  return new Uint8Array([...ftyp, ...moov]);
}

describe("audio metadata tag extraction", () => {
  it("extracts ID3v2 title, artist, album, ISRC, genre, date and label", () => {
    expect(readAudioTags(id3({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genre: "Afrobeats", releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    }))).toEqual({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genres: ["Afrobeats"], releaseDate: "2025-08-27", label: "BlackBeard Entertainment", track: null,
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

  it("extracts standard INFO metadata from WAV masters", () => {
    expect(readAudioTags(wavInfo({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genre: "Afrobeats", releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    }))).toMatchObject({
      title: "Bend Et", artist: "Stunixx", album: "The HoleHearted",
      isrc: "NGABC2600001", genres: ["Afrobeats"], releaseDate: "2025-08-27", label: "BlackBeard Entertainment",
    });
  });

  it("extracts the ID3v1 genre and an ID3v1.1 track number", () => {
    expect(readAudioTags(id3v1({ genre: 17, track: 7 }))).toMatchObject({
      title: "Legacy title", artist: "Legacy artist", album: "Legacy album",
      genres: ["Rock"], releaseDate: "1999", track: 7,
    });
  });

  it("does not invent a genre for unknown ID3v1 genre codes", () => {
    expect(readAudioTags(id3v1({ genre: 255 }))).toMatchObject({ genres: [], track: null });
  });

  it("does not interpret an ID3v1.0 comment byte as a track number", () => {
    expect(readAudioTags(id3v1({ genre: 14, comment: "legacy comment without v1.1 marker" }))).toMatchObject({
      genres: ["R&B"], track: null,
    });
  });

  it("ignores truncated and malformed ID3v1 trailers", () => {
    const truncated = id3v1({ genre: 17, track: 4 }).subarray(0, 127);
    expect(readAudioTags(truncated)).toMatchObject({ genres: [], track: null });
    const malformed = id3v1({ genre: 17, track: 4 });
    malformed[0] = 0;
    expect(readAudioTags(malformed)).toMatchObject({ genres: [], track: null });
  });

  it("extracts ISRCs from Ogg Opus and Vorbis comment packets", () => {
    expect(readAudioTags(oggCommentPage("NG-ABC-26-00001", "opus")).isrc).toBe("NGABC2600001");
    expect(readAudioTags(oggCommentPage("GB-AYE-12-12345", "vorbis")).isrc).toBe("GBAYE1212345");
  });

  it("extracts valid ISRCs and rejects malformed values in MP4/M4A freeform metadata", () => {
    expect(readAudioTags(mp4FreeformIsrc("NG-ABC-26-00001")).isrc).toBe("NGABC2600001");
    expect(readAudioTags(mp4FreeformIsrc("not-an-isrc")).isrc).toBeNull();
  });

  it("does not expose malformed embedded ISRC tag values as recording identifiers", () => {
    expect(readAudioTags(id3({ isrc: "not-an-isrc" })).isrc).toBeNull();
    expect(readAudioTags(flacComments({ ISRC: "USABC12" })).isrc).toBeNull();
    expect(readAudioTags(wavInfo({ isrc: "US-INVALID" })).isrc).toBeNull();
  });

  it("returns an empty structured result for files without recognized tags", () => {
    expect(readAudioTags(new TextEncoder().encode("not an ID3 file"))).toEqual({
      title: null, artist: null, album: null, isrc: null, genres: [], releaseDate: null, label: null, track: null,
    });
  });
});
