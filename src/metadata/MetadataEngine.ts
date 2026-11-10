export type MetadataProvider = "spotify" | "tidal" | "apple_music" | "deezer" | "youtube_music" | "audd" | "id3";

export interface TrackIdentity {
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly isrc: string | null;
  readonly label: string | null;
  readonly releaseDate: string | null;
  readonly genres: readonly string[];
  readonly sourceProviders: readonly MetadataProvider[];
}

export interface StructuredMetadata {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  isrc?: string | null;
  label?: string | null;
  releaseDate?: string | null;
  genres?: readonly string[] | null;
}

export interface AuddMetadata {
  result?: StructuredMetadata | null;
  matched?: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  isrc?: string | null;
  label?: string | null;
  releaseDate?: string | null;
  genres?: readonly string[] | null;
}

export interface Id3Metadata extends StructuredMetadata {}

export interface MetadataEngineInput {
  spotify?: StructuredMetadata | null;
  tidal?: StructuredMetadata | null;
  apple_music?: StructuredMetadata | null;
  deezer?: StructuredMetadata | null;
  youtube_music?: StructuredMetadata | null;
  audd?: AuddMetadata | null;
  id3?: Id3Metadata | null;
  filename?: string | null;
}

const PROVIDER_PRIORITY: readonly MetadataProvider[] = [
  "spotify",
  "tidal",
  "apple_music",
  "deezer",
  "youtube_music",
  "audd",
  "id3",
];

const PLACEHOLDERS = new Set([
  "",
  "n/a",
  "na",
  "not available",
  "unknown",
  "unknown artist",
  "unknown title",
  "null",
  "none",
]);

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (PLACEHOLDERS.has(normalized.toLowerCase())) return null;
  return normalized || null;
}

function cleanDate(value: unknown): string | null {
  const normalized = cleanString(value);
  if (!normalized) return null;
  return normalized;
}

function normalizeIsrc(value: unknown): string | null {
  const normalized = cleanString(value);
  if (!normalized) return null;

  const isrc = normalized.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}[A-Z0-9]{7}$/.test(isrc) ? isrc : normalized.toUpperCase();
}

function cleanGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const genres: string[] = [];
  for (const entry of value) {
    const genre = cleanString(entry);
    if (genre && !genres.some((existing) => existing.toLowerCase() === genre.toLowerCase())) {
      genres.push(genre);
    }
  }

  return genres;
}

function auddMetadata(input: AuddMetadata | null | undefined): StructuredMetadata | null {
  if (!input || input.matched === false) return null;
  if (input.result && typeof input.result === "object") return input.result;
  return input;
}

function parseFilename(filename: string | null | undefined): Pick<TrackIdentity, "title" | "artist"> {
  const cleaned = cleanString(filename)?.replace(/[\\/]+/g, "/").split("/").at(-1) ?? null;
  if (!cleaned) return { title: null, artist: null };

  const withoutExtension = cleaned.replace(/\.[^./]+$/, "").trim();
  if (!withoutExtension) return { title: null, artist: null };

  // Parenthetical track titles commonly contain a meaningful " - " suffix
  // (for example, "(Sittin' On) the Dock of the Bay - Mono"). Preserve those
  // as a single title rather than falsely treating the first half as an artist.
  if (withoutExtension.startsWith("(")) {
    return { title: withoutExtension, artist: null };
  }

  const separator = withoutExtension.indexOf(" - ");
  if (separator > 0 && separator < withoutExtension.length - 3) {
    const artist = cleanString(withoutExtension.slice(0, separator));
    const title = cleanString(withoutExtension.slice(separator + 3));
    if (artist && title) return { artist, title };
  }

  return { title: withoutExtension, artist: null };
}

export class MetadataEngine {
  private constructor() {}

  static normalize(input: MetadataEngineInput): TrackIdentity {
    const providers: Readonly<Record<MetadataProvider, StructuredMetadata | null>> = {
      spotify: input.spotify ?? null,
      tidal: input.tidal ?? null,
      apple_music: input.apple_music ?? null,
      deezer: input.deezer ?? null,
      youtube_music: input.youtube_music ?? null,
      audd: auddMetadata(input.audd),
      id3: input.id3 ?? null,
    };

    const filename = parseFilename(input.filename);

    const title = MetadataEngine.pickField(
      providers,
      "title",
      filename.title,
    );
    const artist = MetadataEngine.pickField(
      providers,
      "artist",
      filename.artist,
    );
    const album = MetadataEngine.pickField(providers, "album", null);
    const isrc = MetadataEngine.pickIsrc(providers);
    const label = MetadataEngine.pickField(providers, "label", null);
    const releaseDate = MetadataEngine.pickField(providers, "releaseDate", null);
    const genres = MetadataEngine.pickGenres(providers);
    const sourceProviders = MetadataEngine.collectSourceProviders(providers);

    const identity: TrackIdentity = Object.freeze({
      title,
      artist,
      album,
      isrc,
      label,
      releaseDate: cleanDate(releaseDate),
      genres: Object.freeze([...genres]),
      sourceProviders: Object.freeze([...sourceProviders]),
    });

    return identity;
  }

  private static pickField(
    providers: Readonly<Record<MetadataProvider, StructuredMetadata | null>>,
    field: keyof StructuredMetadata,
    filenameFallback: string | null,
  ): string | null {
    for (const provider of PROVIDER_PRIORITY) {
      const value = cleanString(providers[provider]?.[field]);
      if (value) return value;
    }
    return filenameFallback;
  }

  private static pickIsrc(
    providers: Readonly<Record<MetadataProvider, StructuredMetadata | null>>,
  ): string | null {
    for (const provider of PROVIDER_PRIORITY) {
      const value = normalizeIsrc(providers[provider]?.isrc);
      if (value) return value;
    }
    return null;
  }

  private static pickGenres(
    providers: Readonly<Record<MetadataProvider, StructuredMetadata | null>>,
  ): string[] {
    for (const provider of PROVIDER_PRIORITY) {
      const genres = cleanGenres(providers[provider]?.genres);
      if (genres.length > 0) return genres;
    }
    return [];
  }

  private static collectSourceProviders(
    providers: Readonly<Record<MetadataProvider, StructuredMetadata | null>>,
  ): MetadataProvider[] {
    return PROVIDER_PRIORITY.filter((provider) => {
      const metadata = providers[provider];
      if (!metadata) return false;

      return [
        cleanString(metadata.title),
        cleanString(metadata.artist),
        cleanString(metadata.album),
        normalizeIsrc(metadata.isrc),
        cleanString(metadata.label),
        cleanDate(metadata.releaseDate),
        ...cleanGenres(metadata.genres),
      ].some(Boolean);
    });
  }
}
