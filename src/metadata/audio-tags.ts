export interface AudioTagMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  isrc: string | null;
  genres: string[];
  releaseDate: string | null;
  label: string | null;
  track: number | null;
}

function normalizeTagIsrc(value: string): string | null {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(normalized) ? normalized : null;
}

const EMPTY: AudioTagMetadata = {
  title: null, artist: null, album: null, isrc: null, genres: [], releaseDate: null, label: null, track: null,
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

function frameMap(id: string): keyof Omit<AudioTagMetadata, "genres" | "track"> | "genres" | null {
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
        else if (!result[field]) result[field] = field === "isrc" ? normalizeTagIsrc(value) : value;
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
        else if (key === "ISRC") result.isrc ??= normalizeTagIsrc(value);
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
          else if (id === "ISRC") result.isrc ??= normalizeTagIsrc(value);
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


interface Mp4Atom {
  type: string;
  payloadStart: number;
  end: number;
}

function mp4AtomChildren(bytes: Uint8Array, start: number, end: number): Mp4Atom[] {
  const atoms: Mp4Atom[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const high = ((bytes[offset + 8]! << 24) | (bytes[offset + 9]! << 16) | (bytes[offset + 10]! << 8) | bytes[offset + 11]!) >>> 0;
      const low = ((bytes[offset + 12]! << 24) | (bytes[offset + 13]! << 16) | (bytes[offset + 14]! << 8) | bytes[offset + 15]!) >>> 0;
      size = high * 0x1_0000_0000 + low;
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
    atoms.push({ type, payloadStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return atoms;
}

function mp4Text(bytes: Uint8Array, atom: Mp4Atom, prefixBytes: number): string | null {
  const start = atom.payloadStart + prefixBytes;
  if (start >= atom.end) return null;
  const value = new TextDecoder("utf-8").decode(bytes.subarray(start, atom.end))
    .replace(/[\u0000]+/g, " ").replace(/\s+/g, " ").trim();
  return value || null;
}

function parseMp4Isrc(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null;
  const topLevel = mp4AtomChildren(bytes, 0, bytes.length);
  if (!topLevel.some((atom) => atom.type === "ftyp")) return null;
  let isrc: string | null = null;

  const visit = (atoms: readonly Mp4Atom[], depth: number): void => {
    if (depth > 8 || isrc) return;
    for (const atom of atoms) {
      if (atom.type === "----" || atom.type === "ISRC" || atom.type === "isrc") {
        const children = mp4AtomChildren(bytes, atom.payloadStart, atom.end);
        const name = children.find((child) => child.type === "name");
        const mean = children.find((child) => child.type === "mean");
        const data = children.find((child) => child.type === "data");
        const isFreeformIsrc = atom.type === "----"
          && Boolean(name && mp4Text(bytes, name, 4)?.toUpperCase() === "ISRC")
          && (!mean || mp4Text(bytes, mean, 4)?.toLowerCase() === "com.apple.itunes");
        const isDirectIsrc = atom.type === "ISRC" || atom.type === "isrc";
        const value = data ? mp4Text(bytes, data, 8) : isDirectIsrc ? mp4Text(bytes, atom, 0) : null;
        if ((isFreeformIsrc || isDirectIsrc) && value) {
          isrc = normalizeTagIsrc(value);
          if (isrc) return;
        }
      }
      if (atom.type === "moov" || atom.type === "udta" || atom.type === "ilst") {
        visit(mp4AtomChildren(bytes, atom.payloadStart, atom.end), depth + 1);
      } else if (atom.type === "meta") {
        // ISO BMFF meta is a FullBox: four version/flags bytes precede child atoms.
        visit(mp4AtomChildren(bytes, Math.min(atom.payloadStart + 4, atom.end), atom.end), depth + 1);
      }
      if (isrc) return;
    }
  };

  visit(topLevel, 0);
  return isrc;
}

const ID3V1_GENRES = [
  "Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal",
  "New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial",
  "Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk",
  "Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise",
  "AlternRock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic",
  "Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta",
  "Top 40","Christian Rap","Pop/Funk","Jungle","Native American","Cabaret","New Wave","Psychedelic","Rave","Showtunes",
  "Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock",
  "Folk","Folk-Rock","National Folk","Swing","Fast Fusion","Bebob","Latin","Revival","Celtic","Bluegrass",
  "Avantgarde","Gothic Rock","Progressive Rock","Psychedelic Rock","Symphonic Rock","Slow Rock","Big Band","Chorus","Easy Listening","Acoustic",
  "Humour","Speech","Chanson","Opera","Chamber Music","Sonata","Symphony","Booty Bass","Primus","Porn Groove",
  "Satire","Slow Jam","Club","Tango","Samba","Folklore","Ballad","Power Ballad","Rhythmic Soul","Freestyle",
  "Duet","Punk Rock","Drum Solo","A Cappella","Euro-House","Dance Hall","Goa","Drum & Bass","Club-House","Hardcore",
  "Terror","Indie","BritPop","Negerpunk","Polsk Punk","Beat","Christian Gangsta Rap","Heavy Metal","Black Metal","Crossover",
  "Contemporary Christian","Christian Rock","Merengue","Salsa","Thrash Metal","Anime","JPop","SynthPop",
] as const;

function parseId3v1(bytes: Uint8Array): AudioTagMetadata {
  if (bytes.length < 128) return { ...EMPTY, genres: [] };
  const offset = bytes.length - 128;
  if (bytes[offset] !== 0x54 || bytes[offset + 1] !== 0x41 || bytes[offset + 2] !== 0x47) return { ...EMPTY, genres: [] };
  const field = (start: number, length: number) => {
    const value = new TextDecoder("windows-1252").decode(bytes.subarray(offset + start, offset + start + length)).replace(/\u0000/g, "").trim();
    return value || null;
  };
  const year = field(93, 4);
  const genre = ID3V1_GENRES[bytes[offset + 127]];
  const trackByte = bytes[offset + 126];
  const track = bytes[offset + 125] === 0 && trackByte > 0 ? trackByte : null;
  return {
    title: field(3, 30), artist: field(33, 30), album: field(63, 30), isrc: null,
    genres: genre ? [genre] : [], releaseDate: year, label: null, track,
  };
}

export function readAudioTags(input: Uint8Array): AudioTagMetadata {
  const v2 = parseId3(input);
  const flac = parseFlacComments(input);
  const wav = parseWavInfo(input);
  const mp4Isrc = parseMp4Isrc(input);
  const v1 = parseId3v1(input);
  return {
    title: v2.title ?? flac.title ?? wav.title ?? v1.title,
    artist: v2.artist ?? flac.artist ?? wav.artist ?? v1.artist,
    album: v2.album ?? flac.album ?? wav.album ?? v1.album,
    isrc: v2.isrc ?? flac.isrc ?? wav.isrc ?? mp4Isrc,
    genres: v2.genres.length ? v2.genres : flac.genres.length ? flac.genres : wav.genres.length ? wav.genres : v1.genres,
    releaseDate: v2.releaseDate ?? flac.releaseDate ?? wav.releaseDate ?? v1.releaseDate,
    label: v2.label ?? flac.label ?? wav.label,
    track: v1.track,
  };
}
