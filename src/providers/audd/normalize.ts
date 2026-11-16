export interface NormalizedAuddRecognition {
  matched: true;
  artist?: string;
  title?: string;
  album?: string;
  releaseDate?: string;
  label?: string;
  isrc?: string;
  songLink?: string;
  timecode?: string;
  spotifyUrl?: string;
  spotifyId?: string;
  appleMusicUrl?: string;
  appleMusicId?: string;
  musicbrainzId?: string;
  rawResponse?: Record<string, unknown>;
}

export interface UnmatchedAuddRecognition {
  matched: false;
  artist?: undefined;
  title?: undefined;
  album?: undefined;
  releaseDate?: undefined;
  label?: undefined;
  isrc?: undefined;
  rawResponse?: Record<string, unknown>;
}

export type AuditRecognition = NormalizedAuddRecognition | UnmatchedAuddRecognition;

type AuddLikeResult = {
  artist?: unknown; title?: unknown; album?: unknown;
  release_date?: unknown; releaseDate?: unknown; label?: unknown; isrc?: unknown;
  song_link?: unknown; songLink?: unknown; timecode?: unknown;
  spotify?: { external_urls?: { spotify?: unknown }; uri?: unknown; id?: unknown } | null;
  apple_music?: { url?: unknown; id?: unknown } | null;
  musicbrainz?: { id?: unknown; recording_id?: unknown } | null;
  musicbrainz_id?: unknown;
  [key: string]: unknown;
};

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

function idFromUri(value: unknown): string | undefined {
  const uri = stringOrUndefined(value);
  if (!uri) return undefined;
  return uri.split("/").at(-1) || undefined;
}

export function normalizeAuddRecognition(input: AuddLikeResult | null | undefined): AuditRecognition {
  if (!input) return { matched: false };
  const artist = stringOrUndefined(input.artist);
  const title = stringOrUndefined(input.title);
  const isrc = stringOrUndefined(input.isrc);
  const spotifyId = stringOrUndefined(input.spotify?.id) ?? idFromUri(input.spotify?.uri);
  const appleMusicId = stringOrUndefined(input.apple_music?.id);
  const musicbrainzId =
    stringOrUndefined(input.musicbrainz_id) ??
    stringOrUndefined(input.musicbrainz?.id) ??
    stringOrUndefined(input.musicbrainz?.recording_id);

  const hasIdentifyingEvidence = Boolean(artist || title || isrc || spotifyId || appleMusicId || musicbrainzId);
  if (!hasIdentifyingEvidence) return { matched: false };

  return {
    matched: true,
    artist,
    title,
    album: stringOrUndefined(input.album),
    releaseDate: stringOrUndefined(input.release_date ?? input.releaseDate),
    label: stringOrUndefined(input.label),
    isrc,
    songLink: stringOrUndefined(input.song_link ?? input.songLink),
    timecode: stringOrUndefined(input.timecode),
    spotifyUrl: stringOrUndefined(input.spotify?.external_urls?.spotify),
    spotifyId,
    appleMusicUrl: stringOrUndefined(input.apple_music?.url),
    appleMusicId,
    musicbrainzId,
    rawResponse: { ...input },
  };
}
