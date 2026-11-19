import { MusicBrainzClient } from "../musicbrainz/client.js";
import { SpotifyClient } from "../spotify/client.js";
import { normalizeSpotifyTrack } from "../spotify/normalize.js";
import { providerDecision } from "../provider-policy.js";
import type { CatalogMetadata } from "./catalog.js";

export interface IsrcProviderOutcome {
  provider: "musicbrainz" | "spotify";
  status: "recognized" | "partial" | "unavailable" | "not_configured";
  reason: string;
}

export interface IsrcCatalogLookup {
  isrc: string;
  metadata: CatalogMetadata[];
  outcomes: IsrcProviderOutcome[];
}

function musicBrainzMetadata(
  isrc: string,
  recordings: Awaited<ReturnType<MusicBrainzClient["lookupIsrc"]>>,
): CatalogMetadata | null {
  if (!recordings.length) return null;
  const uniqueIdentity = recordings.length === 1;
  const recording = uniqueIdentity ? recordings[0] : null;
  const releaseCandidates = recording?.releases ?? [];
  const release = releaseCandidates.length === 1 ? releaseCandidates[0] : null;
  const recordingId = recording?.recordingId ?? null;
  const title = recording?.title ?? null;
  const artist = recording?.artist ?? null;
  return {
    platform: "musicbrainz",
    sourceUrl: `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}`,
    canonicalUrl: recordingId
      ? `https://musicbrainz.org/recording/${encodeURIComponent(recordingId)}`
      : `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}`,
    catalogId: recordingId,
    artist,
    title,
    album: release?.title ?? null,
    releaseDate: release?.date ?? null,
    isrc,
    upc: null,
    catalogPopularity: null,
    catalogPopularityScale: null,
    label: release?.label ?? null,
    genre: null,
    artworkUrl: null,
    previewUrl: null,
    externalIds: recordingId ? { musicbrainz: recordingId } : {},
    sonicProfile: null,
    raw: {
      provider: "musicbrainz",
      matchedRecordingCount: recordings.length,
      recordings,
      releaseSelection: release ? "single_release_match" : "not_selected_ambiguous_or_unavailable",
    },
    evidenceStatus: uniqueIdentity && title && artist ? "recognized" : "partial",
  };
}

export async function collectIsrcCatalogMetadata(
  value: string,
  signal?: AbortSignal,
): Promise<IsrcCatalogLookup> {
  const isrc = value.trim().replace(/[\s-]/g, "").toUpperCase();
  const metadata: CatalogMetadata[] = [];
  const outcomes: IsrcProviderOutcome[] = [];

  const musicBrainzPolicy = providerDecision("musicbrainz");
  if (musicBrainzPolicy.enabled) {
    try {
      const recordings = await new MusicBrainzClient().lookupIsrc(isrc, signal);
      const source = musicBrainzMetadata(isrc, recordings);
      if (source) metadata.push(source);
      outcomes.push({
        provider: "musicbrainz",
        status: source?.evidenceStatus ?? "partial",
        reason: source
          ? recordings.length > 1
            ? "Multiple recording candidates returned; ambiguous fields were withheld."
            : "MusicBrainz returned an ISRC recording match."
          : "MusicBrainz returned no recording for this ISRC.",
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      outcomes.push({
        provider: "musicbrainz",
        status: "unavailable",
        reason: error instanceof Error ? error.message.slice(0, 240) : "MusicBrainz lookup failed.",
      });
    }
  } else {
    outcomes.push({ provider: "musicbrainz", status: "not_configured", reason: musicBrainzPolicy.reason });
  }

  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && providerDecision("spotify").enabled) {
    try {
      const track = await new SpotifyClient().getTrackByIsrc(isrc, signal);
      if (track) {
        const sourceUrl = `https://api.spotify.com/v1/search?q=isrc%3A${encodeURIComponent(isrc)}&type=track`;
        const source = normalizeSpotifyTrack(sourceUrl, track);
        metadata.push(source);
        outcomes.push({ provider: "spotify", status: source.evidenceStatus, reason: "Spotify returned a track for the supplied ISRC." });
      } else {
        outcomes.push({ provider: "spotify", status: "partial", reason: "Spotify returned no track for the supplied ISRC." });
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      outcomes.push({
        provider: "spotify",
        status: "unavailable",
        reason: error instanceof Error ? error.message.slice(0, 240) : "Spotify ISRC lookup failed.",
      });
    }
  } else {
    outcomes.push({
      provider: "spotify",
      status: "not_configured",
      reason: "Spotify client credentials are not configured or provider policy is disabled.",
    });
  }

  return { isrc, metadata, outcomes };
}
