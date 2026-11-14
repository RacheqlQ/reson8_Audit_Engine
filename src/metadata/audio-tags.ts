export interface AudioTagMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  isrc: string | null;
  genres: string[];
  releaseDate: string | null;
  label: string | null;
}

const EMPTY: AudioTagMetadata = {
  title: null, artist: null, album: null, isrc: null, genres: [], releaseDate: null, label: null,
};

function syncSafe(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function decodeText(bytes: Uint8Array): string | null {
  if (!bytes.length) return null;
  const encoding = bytes[0];
  const payload = bytes.subarray(1);
  try {
    let decoded: string;
    if (encoding === 1) decoded = new TextDecoder("utf-16").decode(payload);
    else if (encoding === 2) decoded = new TextDecoder("utf-16be").decode(payload);
    else if (encoding === 3) decoded = new TextDecoder("utf-8").decode(payload);
    else decoded = new TextDecoder("windows-1252").decode(payload);
    const cleaned = decoded.replace(/[\u0000]+/g, " ").replace(/\s+/g, " ").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

function frameMap(id: string): keyof Omit<AudioTagMetadata, "genres"> | "genres" | null {
  switch (id) {
    case "TIT2": return "title";
    case "TPE1": return "artist";
    case "TALB": return "album";
    case "TSRC": return "isrc";
    case "TCON": return "genres";
    case "TDRC":
    case "TYER": return "releaseDate";
    case "TPUB": return "label";
    default: return null;
  }
}

function parseId3(bytes: Uint8Array): AudioTagMetadata {
  const result: AudioTagMetadata = { ...EMPTY, genres: [] };
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return result;
  const version = bytes[3];
  if (version < 2 || version > 4) return result;
  const tagSize = syncSafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  while (offset + 10 <= end) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4
      ? syncSafe(bytes, offset + 4)
      : ((bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7]);
    if (!Number.isFinite(size) || size <= 0 || offset + 10 + size > end) break;
    const field = frameMap(id);
    if (field) {
      const value = decodeText(bytes.subarray(offset + 10, offset + 10 + size));
      if (value) {
        if (field === "genres") result.genres = [...new Set([...result.genres, ...value.split(/[;,/]/).map((item) => item.trim()).filter(Boolean)])];
        else if (!result[field]) result[field] = field === "isrc" ? value.replace(/[\s-]/g, "").toUpperCase() : value;
      }
    }
    offset += 10 + size;
  }
  return result;
}

function parseId3v1(bytes: Uint8Array): AudioTagMetadata {
  if (bytes.length < 128) return { ...EMPTY, genres: [] };
  const offset = bytes.length - 128;
  if (bytes[offset] !== 0x54 || bytes[offset + 1] !== 0x41 || bytes[offset + 2] !== 0x47) return { ...EMPTY, genres: [] };
  const field = (start: number, length: number) => {
    const value = new TextDecoder("windows-1252").decode(bytes.subarray(offset + start, offset + start + length)).replace(/\u0000/g, "").trim();
    return value || null;
  };
  const year = field(93, 4);
  return {
    title: field(3, 30), artist: field(33, 30), album: field(63, 30), isrc: null,
    genres: [], releaseDate: year, label: null,
  };
}

export function readAudioTags(input: Uint8Array): AudioTagMetadata {
  const v2 = parseId3(input);
  const v1 = parseId3v1(input);
  return {
    title: v2.title ?? v1.title,
    artist: v2.artist ?? v1.artist,
    album: v2.album ?? v1.album,
    isrc: v2.isrc,
    genres: v2.genres.length ? v2.genres : v1.genres,
    releaseDate: v2.releaseDate ?? v1.releaseDate,
    label: v2.label,
  };
}
