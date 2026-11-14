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
    case "TIT2":
    case "TT2": return "title";
    case "TPE1":
    case "TP1": return "artist";
    case "TALB":
    case "TAL": return "album";
    case "TSRC":
    case "TRC": return "isrc";
    case "TCON":
    case "TCO": return "genres";
    case "TDRC":
    case "TYER":
    case "TYE": return "releaseDate";
    case "TPUB":
    case "TPB": return "label";
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
  const headerSize = version === 2 ? 6 : 10;
  while (offset + headerSize <= end) {
    const idLength = version === 2 ? 3 : 4;
    const id = String.fromCharCode(...bytes.subarray(offset, offset + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = version === 2
      ? (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
      : version === 4
        ? syncSafe(bytes, offset + 4)
        : ((bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7]);
    if (!Number.isFinite(size) || size <= 0 || offset + headerSize + size > end) break;
    const field = frameMap(id);
    if (field) {
      const value = decodeText(bytes.subarray(offset + headerSize, offset + headerSize + size));
      if (value) {
        if (field === "genres") result.genres = [...new Set([...result.genres, ...value.split(/[;,/]/).map((item) => item.trim()).filter(Boolean)])];
        else if (!result[field]) result[field] = field === "isrc" ? value.replace(/[\s-]/g, "").toUpperCase() : value;
      }
    }
    offset += headerSize + size;
  }
  return result;
}

function littleEndian32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function parseFlacComments(bytes: Uint8Array): AudioTagMetadata {
  const result: AudioTagMetadata = { ...EMPTY, genres: [] };
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return result;
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const type = bytes[offset] & 0x7f;
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const blockStart = offset + 4, blockEnd = blockStart + length;
    if (blockEnd > bytes.length) break;
    if (type === 4 && length >= 8) {
      let cursor = blockStart;
      const vendorLength = littleEndian32(bytes, cursor); cursor += 4 + vendorLength;
      if (cursor + 4 > blockEnd) break;
      const count = Math.min(littleEndian32(bytes, cursor), 1000); cursor += 4;
      for (let index = 0; index < count && cursor + 4 <= blockEnd; index++) {
        const commentLength = littleEndian32(bytes, cursor); cursor += 4;
        if (commentLength <= 0 || cursor + commentLength > blockEnd) break;
        const comment = new TextDecoder("utf-8").decode(bytes.subarray(cursor, cursor + commentLength));
        cursor += commentLength;
        const separator = comment.indexOf("=");
        if (separator <= 0) continue;
        const key = comment.slice(0, separator).trim().toUpperCase();
        const value = comment.slice(separator + 1).trim();
        if (!value) continue;
        if (key === "TITLE") result.title ??= value;
        else if (key === "ARTIST" || key === "ALBUMARTIST") result.artist ??= value;
        else if (key === "ALBUM") result.album ??= value;
        else if (key === "ISRC") result.isrc ??= value.replace(/[\s-]/g, "").toUpperCase();
        else if (key === "GENRE") result.genres = [...new Set([...result.genres, ...value.split(/[;,/]/).map((item) => item.trim()).filter(Boolean)])];
        else if (key === "DATE" || key === "YEAR" || key === "RELEASEDATE") result.releaseDate ??= value;
        else if (key === "LABEL" || key === "ORGANIZATION") result.label ??= value;
      }
    }
    offset = blockEnd;
    if (bytes[offset - length - 4] & 0x80) break;
  }
  return result;
}
function parseWavInfo(bytes: Uint8Array): AudioTagMetadata {
  const result: AudioTagMetadata = { ...EMPTY, genres: [] };
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") return result;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = littleEndian32(bytes, offset + 4);
    const start = offset + 8, end = start + length;
    if (end > bytes.length) break;
    if (chunkId === "LIST" && length >= 4 && String.fromCharCode(...bytes.subarray(start, start + 4)) === "INFO") {
      let cursor = start + 4;
      while (cursor + 8 <= end) {
        const id = String.fromCharCode(...bytes.subarray(cursor, cursor + 4));
        const size = littleEndian32(bytes, cursor + 4);
        const valueStart = cursor + 8, valueEnd = valueStart + size;
        if (valueEnd > end) break;
        const value = new TextDecoder("windows-1252").decode(bytes.subarray(valueStart, valueEnd)).replace(/\u0000/g, "").trim();
        if (value) {
          if (id === "INAM") result.title ??= value;
          else if (id === "IART") result.artist ??= value;
          else if (id === "IPRD") result.album ??= value;
          else if (id === "ISRC") result.isrc ??= value.replace(/[\s-]/g, "").toUpperCase();
          else if (id === "IGNR") result.genres = [...new Set([...result.genres, ...value.split(/[;,/]/).map((item) => item.trim()).filter(Boolean)])];
          else if (id === "ICRD") result.releaseDate ??= value;
          else if (id === "IPUB" || id === "ICOP") result.label ??= value;
        }
        cursor = valueEnd + (size % 2);
      }
    }
    offset = end + (length % 2);
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
  const flac = parseFlacComments(input);
  const wav = parseWavInfo(input);
  const v1 = parseId3v1(input);
  return {
    title: v2.title ?? flac.title ?? wav.title ?? v1.title,
    artist: v2.artist ?? flac.artist ?? wav.artist ?? v1.artist,
    album: v2.album ?? flac.album ?? wav.album ?? v1.album,
    isrc: v2.isrc ?? flac.isrc ?? wav.isrc,
    genres: v2.genres.length ? v2.genres : flac.genres.length ? flac.genres : wav.genres.length ? wav.genres : v1.genres,
    releaseDate: v2.releaseDate ?? flac.releaseDate ?? wav.releaseDate ?? v1.releaseDate,
    label: v2.label ?? flac.label ?? wav.label,
  };
}
