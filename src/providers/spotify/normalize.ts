import type { CatalogMetadata } from "../dsp/catalog.js";

type SpotifyArtist = { id?: unknown; name?: unknown; external_urls?: { spotify?: unknown } };
type SpotifyTrack = {
  id?: unknown; name?: unknown; artists?: SpotifyArtist[];
  album?: { id?: unknown; name?: unknown; release_date?: unknown; external_urls?: { spotify?: unknown }; images?: Array<{ url?: unknown }> };
  external_ids?: { isrc?: unknown; upc?: unknown; ean?: unknown };
  external_urls?: { spotify?: unknown };
  duration_ms?: unknown; preview_url?: unknown; popularity?: unknown; is_playable?: unknown;
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizedIsrc = (value: unknown): string | null => {
  const valueString = stringValue(value);
  return valueString ? valueString.replace(/[\\s-]/g, "").toUpperCase() : null;
};

export function normalizeSpotifyTrack(sourceUrl: string, track: SpotifyTrack): CatalogMetadata {
  const artist = track.artists?.map((entry) => stringValue(entry.name)).find(Boolean) ?? null;
  const title = stringValue(track.name);
  const album = track.album;
  const spotifyId = stringValue(track.id);
  const canonicalUrl = stringValue(track.external_urls?.spotify) ?? sourceUrl;
  const isrc = normalizedIsrc(track.external_ids?.isrc);
  const upc = stringValue(track.external_ids?.upc) ?? stringValue(track.external_ids?.ean);

  return {
    platform: "spotify",
    sourceUrl,
    canonicalUrl,
    catalogId: spotifyId,
    artist,
    title,
    album: stringValue(album?.name),
    releaseDate: stringValue(album?.release_date),
    isrc,
    upc,
    catalogPopularity: typeof track.popularity === "number" && Number.isFinite(track.popularity) ? track.popularity : null,
    catalogPopularityScale: typeof track.popularity === "number" && Number.isFinite(track.popularity) ? "0_100" : null,
    label: null,
    genre: null,
    artworkUrl: stringValue(album?.images?.[0]?.url),
    previewUrl: stringValue(track.preview_url),
    externalIds: spotifyId ? { spotify: spotifyId } : {},
    sonicProfile: null,
    raw: track as Record<string, unknown>,
    evidenceStatus: title && artist ? "recognized" : "partial",
  };
}