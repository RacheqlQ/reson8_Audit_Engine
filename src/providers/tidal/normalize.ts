import type { CatalogMetadata, CatalogSonicProfile } from "../dsp/catalog.js";

type TidalResource = {
  type?: unknown;
  id?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

type TidalDocument = {
  data?: TidalResource;
  included?: TidalResource[];
  links?: { self?: unknown };
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizedIsrc = (value: unknown): string | null => {
  const valueString = stringValue(value);
  return valueString ? valueString.replace(/[\s-]/g, "").toUpperCase() : null;
};

function includedResources(
  document: TidalDocument,
  type: string,
): TidalResource[] {
  return document.included?.filter((entry) => entry.type === type) ?? [];
}

function includedResource(
  document: TidalDocument,
  type: string,
  id: string | null,
): TidalResource | null {
  if (!id) return null;
  return includedResources(document, type).find(
    (entry) => String(entry.id) === id,
  ) ?? null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string =>
    typeof entry === "string" && entry.trim().length > 0,
  ).map((entry) => entry.trim());
}

function normalizeMode(value: unknown): "major" | "minor" | null {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "major") return "major";
  if (normalized === "minor") return "minor";
  return null;
}

function sonicProfile(
  attributes: Record<string, unknown>,
  genres: string[],
): CatalogSonicProfile | null {
  const bpm = numberValue(attributes.bpm);
  const key = stringValue(attributes.key);
  const mode = normalizeMode(attributes.keyScale);
  const moodTags = stringArray(attributes.toneTags);

  if (bpm === null && !key && !mode && moodTags.length === 0 && genres.length === 0) {
    return null;
  }

  return {
    provenance: "tidal_catalog_metadata",
    bpm,
    key,
    mode,
    moodTags,
    genreContext: genres,
  };
}

export function normalizeTidalTrack(
  sourceUrl: string,
  documentInput: Record<string, unknown>,
): CatalogMetadata {
  const document = documentInput as TidalDocument;
  const track = document.data;
  const attributes = track?.attributes ?? {};

  const artistRelationship = (
    track?.relationships as Record<string, unknown> | undefined
  )?.artists as { data?: TidalResource[] } | undefined;
  const albumRelationship = (
    track?.relationships as Record<string, unknown> | undefined
  )?.albums as { data?: TidalResource[] } | undefined;

  const artistRef = artistRelationship?.data?.[0];
  const albumRef = albumRelationship?.data?.[0];

  const artist = includedResource(
    document,
    "artists",
    artistRef?.id ? String(artistRef.id) : null,
  );
  const album = includedResource(
    document,
    "albums",
    albumRef?.id ? String(albumRef.id) : null,
  );

  const title = stringValue(attributes.title);
  const artistName = stringValue(artist?.attributes?.name);
  const albumTitle = stringValue(album?.attributes?.title);
  const genres = includedResources(document, "genres")
    .map((entry) => stringValue(entry.attributes?.name))
    .filter((value): value is string => Boolean(value));
  const providers = includedResources(document, "providers");
  const label = providers
    .map((entry) =>
      stringValue(entry.attributes?.name) ??
      stringValue(entry.attributes?.label) ??
      stringValue(entry.attributes?.title),
    )
    .find(Boolean) ?? stringValue(attributes.label);

  const tidalId = stringValue(track?.id);
  const canonicalUrl = sourceUrl;

  const releaseDate =
    stringValue(attributes.releaseDate) ??
    stringValue(album?.attributes?.releaseDate);

  const isrc = normalizedIsrc(attributes.isrc);

  return {
    platform: "tidal",
    sourceUrl,
    canonicalUrl,
    catalogId: tidalId,
    artist: artistName,
    title,
    album: albumTitle,
    releaseDate,
    isrc,
    upc: null,
    catalogPopularity: numberValue(attributes.popularity),
    catalogPopularityScale: numberValue(attributes.popularity) === null ? null : "0_1",
    label,
    genre: genres[0] ?? stringValue(attributes.genre),
    artworkUrl: null,
    previewUrl: null,
    externalIds: tidalId ? { tidal: tidalId } : {},
    raw: documentInput,
    evidenceStatus: title && artistName ? "recognized" : "partial",
    sonicProfile: sonicProfile(attributes, genres),
  };
}
