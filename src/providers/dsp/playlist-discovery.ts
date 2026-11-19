import { SpotifyClient } from "../spotify/client.js";

export interface PlaylistDiscoveryInput {
  isrc: string | null;
  artist?: string | null;
  title?: string | null;
  primaryGenre: string | null;
  adjacentLanes?: readonly string[];
  moodTags?: readonly string[];
  storefront?: string;
}

export interface PlaylistCandidate {
  provider: "spotify" | "apple_music";
  id: string;
  name: string;
  url: string;
  sourceUrl: string;
  curatorName: string | null;
  playlistType: string | null;
  description: string | null;
  trackCount: number | null;
  genreMatches: string[];
  moodMatches: string[];
  matchBasis: string[];
  containsIsrc: boolean | null;
  retrievedAt: string;
}

export interface PlaylistDiscoveryOutcome {
  provider: "spotify" | "apple_music";
  status: "available" | "no_matches" | "not_configured" | "unavailable";
  reason: string;
}

export interface PlaylistDiscoveryResult {
  status: "available" | "partial" | "no_matches" | "not_configured" | "unavailable";
  candidates: PlaylistCandidate[];
  outcomes: PlaylistDiscoveryOutcome[];
}

export interface SpotifyPlaylistSearchClient {
  searchPlaylists(query: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>>;
}

export interface PlaylistDiscoveryDependencies {
  spotifyClient?: SpotifyPlaylistSearchClient | null;
  fetcher?: typeof fetch;
  appleMusicToken?: string | null;
  storefront?: string;
  now?: () => Date;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildPlaylistSearchTerms(input: Pick<PlaylistDiscoveryInput, "primaryGenre" | "adjacentLanes" | "moodTags">): string[] {
  const lanes = unique([input.primaryGenre ?? "", ...(input.adjacentLanes ?? [])]).slice(0, 4);
  const moods = unique(input.moodTags ?? []).slice(0, 2);
  const terms = [...lanes, ...lanes.slice(0, 2).flatMap((lane) => moods.map((mood) => lane + " " + mood))];
  return unique(terms).slice(0, 5);
}

function extractPlaylistText(name: unknown, description: unknown): string {
  return normalize([clean(name), clean(description)].filter(Boolean).join(" "));
}

function matches(labels: readonly string[], haystack: string): string[] {
  return labels.filter((label) => {
    const token = normalize(label);
    return token.length > 1 && haystack.includes(token);
  });
}

function playlistUrl(provider: "spotify" | "apple_music", id: string, value: unknown): string {
  const supplied = clean(value);
  if (supplied.startsWith("https://")) return supplied;
  return provider === "spotify"
    ? "https://open.spotify.com/playlist/" + encodeURIComponent(id)
    : "https://music.apple.com/playlist/" + encodeURIComponent(id);
}

function makeCandidate(input: {
  provider: "spotify" | "apple_music";
  id: string;
  name: string;
  url: string;
  curatorName?: string | null;
  playlistType?: string | null;
  description?: string | null;
  trackCount?: number | null;
  trackGenres?: readonly string[];
  containsIsrc?: boolean | null;
  lanes: readonly string[];
  moods: readonly string[];
  retrievedAt: string;
}): PlaylistCandidate | null {
  const text = extractPlaylistText(input.name, input.description);
  const genreMatches = unique([
    ...matches(input.lanes, text),
    ...matches(input.lanes, normalize(input.trackGenres?.join(" ") ?? "")),
  ]);
  const moodMatches = matches(input.moods, text);
  const matchBasis = [
    ...genreMatches.map((genre) => (input.lanes[0] === genre ? "Primary genre match: " : "Adjacent lane match: ") + genre),
    ...moodMatches.map((mood) => "Mood tag match: " + mood),
  ];
  if (input.containsIsrc === true) matchBasis.unshift("The audited recording ISRC is already present in this playlist");
  if (!matchBasis.length) return null;
  return {
    provider: input.provider,
    id: input.id,
    name: input.name,
    url: input.url,
    sourceUrl: input.url,
    curatorName: input.curatorName ?? null,
    playlistType: input.playlistType ?? null,
    description: input.description ?? null,
    trackCount: input.trackCount ?? null,
    genreMatches,
    moodMatches,
    matchBasis,
    containsIsrc: input.containsIsrc ?? null,
    retrievedAt: input.retrievedAt,
  };
}

async function appleRequest(url: string, token: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const response = await fetcher(url, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    signal,
    redirect: "error",
  });
  if (!response.ok) throw new Error("Apple Music catalog request failed with HTTP " + response.status);
  const payload = await response.json() as Record<string, unknown>;
  return payload;
}

export async function discoverPlaylistCandidates(
  input: PlaylistDiscoveryInput,
  dependencies: PlaylistDiscoveryDependencies = {},
  signal?: AbortSignal,
): Promise<PlaylistDiscoveryResult> {
  const terms = buildPlaylistSearchTerms(input);
  const lanes = unique([input.primaryGenre ?? "", ...(input.adjacentLanes ?? [])]);
  const moods = unique(input.moodTags ?? []);
  const now = dependencies.now ?? (() => new Date());
  const retrievedAt = now().toISOString();
  const outcomes: PlaylistDiscoveryOutcome[] = [];
  const candidates = new Map<string, PlaylistCandidate>();
  const spotifyClient = dependencies.spotifyClient === undefined
    ? process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
      ? new SpotifyClient()
      : null
    : dependencies.spotifyClient;
  const fetcher = dependencies.fetcher ?? fetch;
  const appleToken = dependencies.appleMusicToken === undefined
    ? process.env.APPLE_MUSIC_DEVELOPER_TOKEN ?? null
    : dependencies.appleMusicToken;
  const storefront = (dependencies.storefront ?? input.storefront ?? process.env.APPLE_MUSIC_STOREFRONT ?? "ng").toLowerCase();

  if (spotifyClient) {
    try {
      let found = 0;
      for (const term of terms.slice(0, 3)) {
        signal?.throwIfAborted();
        const items = await spotifyClient.searchPlaylists(term, signal);
        for (const item of items) {
          const id = clean(item.id);
          const name = clean(item.name);
          if (!id || !name) continue;
          const owner = item.owner && typeof item.owner === "object" ? item.owner as Record<string, unknown> : {};
          const external = item.external_urls && typeof item.external_urls === "object" ? item.external_urls as Record<string, unknown> : {};
          const tracks = item.tracks && typeof item.tracks === "object" ? item.tracks as Record<string, unknown> : {};
          const candidate = makeCandidate({
            provider: "spotify",
            id,
            name,
            url: playlistUrl("spotify", id, external.spotify),
            curatorName: clean(owner.display_name) || null,
            description: clean(item.description) || null,
            trackCount: typeof tracks.total === "number" ? tracks.total : null,
            containsIsrc: null,
            lanes,
            moods,
            retrievedAt,
          });
          if (candidate) {
            candidates.set("spotify:" + id, candidate);
            found++;
          }
        }
      }
      outcomes.push({ provider: "spotify", status: found ? "available" : "no_matches", reason: found ? "Spotify catalog search returned genre- or mood-aligned public playlist metadata; public playlist contents were not inspected." : "No matching public playlist metadata was returned by Spotify search." });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      outcomes.push({ provider: "spotify", status: "unavailable", reason: error instanceof Error ? error.message.slice(0, 180) : "Spotify playlist search failed." });
    }
  } else {
    outcomes.push({ provider: "spotify", status: "not_configured", reason: "Spotify client credentials are not configured." });
  }

  if (appleToken) {
    try {
      const appleResults = new Map<string, Record<string, unknown>>();
      for (const term of terms.slice(0, 3)) {
        signal?.throwIfAborted();
        const params = new URLSearchParams({ term, types: "playlists", limit: "10" });
        const payload = await appleRequest("https://api.music.apple.com/v1/catalog/" + storefront + "/search?" + params.toString(), appleToken, fetcher, signal);
        const results = payload.results && typeof payload.results === "object" ? payload.results as Record<string, unknown> : {};
        const playlists = results.playlists && typeof results.playlists === "object" ? results.playlists as Record<string, unknown> : {};
        const data = Array.isArray(playlists.data) ? playlists.data as Array<Record<string, unknown>> : [];
        for (const item of data) {
          const id = clean(item.id);
          if (id) appleResults.set(id, item);
        }
      }

      let found = 0;
      for (const [id, item] of [...appleResults.entries()].slice(0, 5)) {
        const attributes = item.attributes && typeof item.attributes === "object" ? item.attributes as Record<string, unknown> : {};
        const name = clean(attributes.name);
        if (!name) continue;
        const url = playlistUrl("apple_music", id, attributes.url);
        const tracksPayload = await appleRequest("https://api.music.apple.com/v1/catalog/" + storefront + "/playlists/" + encodeURIComponent(id) + "/tracks?limit=100", appleToken, fetcher, signal);
        const tracks = Array.isArray(tracksPayload.data) ? tracksPayload.data as Array<Record<string, unknown>> : [];
        const trackGenres = tracks.flatMap((track) => {
          const trackAttributes = track.attributes && typeof track.attributes === "object" ? track.attributes as Record<string, unknown> : {};
          return Array.isArray(trackAttributes.genreNames) ? trackAttributes.genreNames.filter((value): value is string => typeof value === "string") : [];
        });
        const isrc = input.isrc?.replace(/[\s-]/g, "").toUpperCase() ?? "";
        const containsIsrc = isrc
          ? tracks.some((track) => {
              const trackAttributes = track.attributes && typeof track.attributes === "object" ? track.attributes as Record<string, unknown> : {};
              return clean(trackAttributes.isrc).replace(/[\s-]/g, "").toUpperCase() === isrc;
            })
          : null;
        const candidate = makeCandidate({
          provider: "apple_music",
          id,
          name,
          url,
          curatorName: clean(attributes.curatorName) || null,
          playlistType: clean(attributes.playlistType) || null,
          description: attributes.description && typeof attributes.description === "object"
            ? clean((attributes.description as Record<string, unknown>).standard)
            : null,
          trackCount: typeof playlistsCount(attributes) === "number" ? playlistsCount(attributes) : tracks.length,
          trackGenres,
          containsIsrc,
          lanes,
          moods,
          retrievedAt,
        });
        if (candidate) {
          candidates.set("apple_music:" + id, candidate);
          found++;
        }
      }
      outcomes.push({ provider: "apple_music", status: found ? "available" : "no_matches", reason: found ? "Apple Music catalog returned matching playlists and their available track metadata was inspected for ISRC and genre alignment." : "No matching Apple Music catalog playlists were returned." });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      outcomes.push({ provider: "apple_music", status: "unavailable", reason: error instanceof Error ? error.message.slice(0, 180) : "Apple Music playlist search failed." });
    }
  } else {
    outcomes.push({ provider: "apple_music", status: "not_configured", reason: "Apple Music developer token is not configured." });
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (a.containsIsrc !== b.containsIsrc) return a.containsIsrc === true ? -1 : b.containsIsrc === true ? 1 : 0;
    return b.matchBasis.length - a.matchBasis.length || a.name.localeCompare(b.name);
  });
  const configured = outcomes.some((outcome) => outcome.status !== "not_configured");
  const status = ordered.length
    ? outcomes.some((outcome) => outcome.status === "unavailable") ? "partial" : "available"
    : configured ? outcomes.some((outcome) => outcome.status === "unavailable") ? "unavailable" : "no_matches" : "not_configured";
  return { status, candidates: ordered.slice(0, 12), outcomes };
}

function playlistsCount(attributes: Record<string, unknown>): number | null {
  const count = attributes.trackCount ?? attributes.totalTracks;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}
