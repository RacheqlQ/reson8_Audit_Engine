import { SpotifyClient } from "../spotify/client.js";
import { normalizeSpotifyTrack } from "../spotify/normalize.js";
import { TidalClient } from "../tidal/client.js";
import { normalizeTidalTrack } from "../tidal/normalize.js";
import { AudiomackClient } from "../audiomack/client.js";
import { providerDecision, type ProviderId } from "../provider-policy.js";

export type DspPlatform = "spotify" | "apple_music" | "youtube_music" | "deezer" | "tidal" | "audiomack" | "musicbrainz" | "unknown";

export interface CatalogSonicProfile {
  provenance: "tidal_catalog_metadata";
  bpm: number | null;
  key: string | null;
  mode: "major" | "minor" | null;
  moodTags: string[];
  genreContext: string[];
}

export interface CatalogMetadata {
  platform: DspPlatform; sourceUrl: string; canonicalUrl: string; catalogId: string | null;
  artist: string | null; title: string | null; album: string | null; releaseDate: string | null;
  isrc: string | null; upc: string | null; catalogPopularity: number | null; catalogPopularityScale: "0_1" | "0_100" | null; label: string | null; genre: string | null;
  artworkUrl: string | null; previewUrl: string | null; externalIds: Record<string,string>; sonicProfile: CatalogSonicProfile | null;
  raw: Record<string,unknown>; evidenceStatus: "recognized" | "partial";
}

const HOSTS: Record<string,DspPlatform> = {
  "open.spotify.com":"spotify","play.spotify.com":"spotify","music.apple.com":"apple_music","geo.music.apple.com":"apple_music",
  "itunes.apple.com":"apple_music","music.youtube.com":"youtube_music","deezer.com":"deezer",
  "www.deezer.com":"deezer","tidal.com":"tidal","listen.tidal.com":"tidal","audiomack.com":"audiomack","www.audiomack.com":"audiomack"
};

function normalizeUrl(input:string){const u=new URL(input.trim());if(u.protocol!=="https:")throw new Error("DSP URL must use HTTPS");if(u.username||u.password)throw new Error("DSP URL must not contain credentials");if(u.port)throw new Error("DSP URL must not use a custom port");if(!HOSTS[u.hostname.toLowerCase()])throw new Error("Unsupported DSP or catalog URL");return u;}
function idFromPath(u:URL,p:DspPlatform){const a=u.pathname.split("/").filter(Boolean);if(p==="spotify"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}if(p==="apple_music"){const song=a.indexOf("song"),album=a.indexOf("album");if(song>=0&&(album<0||song<album)){const first=a[song+1];const directId=/^\d+$/.test(first??"")?first:a[song+2];const queryId=u.searchParams.get("i");if(directId&&/^\d+$/.test(directId)&&(!queryId||queryId===directId))return directId;return null;}return u.searchParams.get("i");}if(p==="deezer"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}if(p==="tidal"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}if(p==="audiomack"){const artist=a[0],slug=a[1]==="song"?a[2]:a[1];return artist&&slug?`${artist}/${slug}`:null;}return u.searchParams.get("v")??(u.hostname==="youtu.be"?a[0]??null:null);}
function base(p:DspPlatform,u:URL):CatalogMetadata{return{platform:p,sourceUrl:u.toString(),canonicalUrl:u.toString(),catalogId:idFromPath(u,p),artist:null,title:null,album:null,releaseDate:null,isrc:null,upc:null,catalogPopularity:null,catalogPopularityScale:null,label:null,genre:null,artworkUrl:null,previewUrl:null,externalIds:{},raw:{},evidenceStatus:"partial",sonicProfile:null};}

async function spotify(u:URL, signal?:AbortSignal){
  const metadata = base("spotify", u);
  const id = metadata.catalogId;
  if (!id) throw new Error("Spotify track ID could not be detected");

  try {
    const client = new SpotifyClient();
    const track = await client.getTrack(id, signal);
    let normalized = normalizeSpotifyTrack(u.toString(), track);
    const artists = Array.isArray(track.artists) ? track.artists as Array<Record<string, unknown>> : [];
    const artistId = typeof artists[0]?.id === "string" ? artists[0].id : null;
    if (artistId) {
      try {
        const artist = await client.getArtist(artistId, signal);
        const genres = Array.isArray(artist.genres)
          ? artist.genres.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        if (genres.length) normalized = { ...normalized, genre: genres[0], raw: { ...normalized.raw, artistGenres: genres } };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        // Track metadata remains valid if optional artist-genre enrichment is unavailable.
      }
    }
    const album = track.album && typeof track.album === "object" ? track.album as Record<string, unknown> : {};
    const albumId = typeof album.id === "string" ? album.id : null;
    if (albumId && client.getAlbum) {
      try {
        const albumDetails = await client.getAlbum(albumId, signal);
        const externalIds = albumDetails.external_ids && typeof albumDetails.external_ids === "object"
          ? albumDetails.external_ids as Record<string, unknown> : {};
        const upc = typeof externalIds.upc === "string" ? externalIds.upc : normalized.upc;
        const label = typeof albumDetails.label === "string" ? albumDetails.label : normalized.label;
        normalized = { ...normalized, upc, label, raw: { ...normalized.raw, albumMetadata: albumDetails } };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        // Missing album enrichment does not invalidate recognized track identity.
      }
    }
    return normalized;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    // Spotify is optional enrichment for the audit pipeline. A denied or
    // unavailable Spotify API must never prevent the audit from completing.
    const message = error instanceof Error ? error.message : "Unknown Spotify enrichment error";
    return {
      ...metadata,
      raw: {
        spotifyEnrichment: {
          status: "unavailable",
          error: message,
        },
      },
    };
  }
}

async function apple(u: URL, signal?: AbortSignal) {
  const metadata = base("apple_music", u);
  if (!metadata.catalogId) throw new Error("Apple Music track ID could not be detected");

  // Apple Music share URLs are storefront-specific. Querying the US default
  // for a track shared from another storefront can return no result even
  // when the track is available in that storefront.
  const pathStorefront = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const queryStorefront = u.searchParams.get("country")?.toLowerCase();
  const storefront = pathStorefront && /^[a-z]{2}$/.test(pathStorefront) ? pathStorefront : queryStorefront;
  const appleStorefront = storefront && /^[a-z]{2}$/.test(storefront)
    ? storefront : (process.env.APPLE_MUSIC_STOREFRONT ?? "ng").toLowerCase();
  const developerToken = process.env.APPLE_MUSIC_DEVELOPER_TOKEN?.trim();
  let appleApiFailure: Record<string, unknown> | null = null;

  // The public iTunes lookup response is not a dependable source of ISRC.
  // When the configured Apple Music developer token is present, prefer the
  // catalog song resource, whose attributes include the recording ISRC.
  if (developerToken) {
    try {
      const catalogUrl = "https://api.music.apple.com/v1/catalog/"
        + encodeURIComponent(appleStorefront) + "/songs/" + encodeURIComponent(metadata.catalogId);
      const catalogResponse = await fetch(catalogUrl, {
        signal, redirect: "error",
        headers: { Authorization: "Bearer " + developerToken },
      });
      if (catalogResponse.ok) {
        const payload = await catalogResponse.json() as { data?: Array<Record<string, unknown>> };
        const song = payload.data?.find((item) => item.type === "songs") ?? payload.data?.[0];
        const attributes = song?.attributes && typeof song.attributes === "object"
          ? song.attributes as Record<string, unknown> : null;
        if (attributes) {
          const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
          const genres = Array.isArray(attributes.genreNames)
            ? attributes.genreNames.filter((value): value is string => typeof value === "string" && value.trim()) : [];
          const previews = Array.isArray(attributes.previews)
            ? attributes.previews.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
          const artwork = attributes.artwork && typeof attributes.artwork === "object"
            ? attributes.artwork as Record<string, unknown> : {};
          metadata.canonicalUrl = stringValue(attributes.url) ?? metadata.canonicalUrl;
          metadata.artist = stringValue(attributes.artistName);
          metadata.title = stringValue(attributes.name);
          metadata.album = stringValue(attributes.albumName);
          metadata.releaseDate = stringValue(attributes.releaseDate)?.slice(0, 10) ?? null;
          metadata.genre = genres[0] ?? null;
          metadata.isrc = stringValue(attributes.isrc);
          metadata.previewUrl = stringValue(previews[0]?.url);
          if (song?.id) metadata.externalIds.apple_music = String(song.id);
          if (typeof artwork.url === "string") metadata.artworkUrl = artwork.url;
          metadata.raw = { appleMusicCatalog: song };
          metadata.evidenceStatus = metadata.title && metadata.artist ? "recognized" : "partial";
          return metadata;
        }
        appleApiFailure = { status: "unavailable", reason: "Apple Music catalog returned no song attributes." };
      } else {
        appleApiFailure = { status: "unavailable", reason: "Apple Music catalog returned HTTP " + catalogResponse.status };
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      appleApiFailure = { status: "unavailable", reason: error instanceof Error ? error.message.slice(0, 180) : "Apple Music catalog lookup failed." };
    }
  }

  const lookup = new URL("https://itunes.apple.com/lookup");
  lookup.searchParams.set("id", metadata.catalogId);
  lookup.searchParams.set("entity", "song");
  if (storefront && /^[a-z]{2}$/.test(storefront)) {
    lookup.searchParams.set("country", storefront);
  }

  const response = await fetch(lookup.toString(), { signal, redirect: "error" });
  if (!response.ok) throw new Error("Apple Music metadata request failed with HTTP " + response.status);
  const data = await response.json() as { results?: Array<Record<string, unknown>> };
  const track = data.results?.find((item) => item.kind === "song") ?? data.results?.[0];
  if (!track) throw new Error("Apple Music track was not found");

  metadata.canonicalUrl = String(track.trackViewUrl ?? u);
  metadata.artist = String(track.artistName ?? "") || null;
  metadata.title = String(track.trackName ?? "") || null;
  metadata.album = String(track.collectionName ?? "") || null;
  metadata.releaseDate = String(track.releaseDate ?? "").slice(0, 10) || null;
  metadata.genre = String(track.primaryGenreName ?? "") || null;
  metadata.artworkUrl = String(track.artworkUrl100 ?? "") || null;
  metadata.previewUrl = String(track.previewUrl ?? "") || null;
  metadata.isrc = String(track.isrc ?? "") || null;
  if (track.trackId) metadata.externalIds.apple_music = String(track.trackId);
  metadata.raw = appleApiFailure ? { appleMusicCatalogLookup: appleApiFailure, itunesLookup: track } : track;
  metadata.evidenceStatus = metadata.title && metadata.artist ? "recognized" : "partial";
  return metadata;
}
async function tidal(u:URL, signal?:AbortSignal){
  const id=idFromPath(u,"tidal");
  if(!id){
    const path=u.pathname.split("/").filter(Boolean);
    if(path.includes("playlist")) throw new Error("TIDAL playlist URLs are not supported for single-track audits. Submit a TIDAL track URL.");
    throw new Error("TIDAL track ID could not be detected");
  }
  const client=new TidalClient();
  const track=await client.getTrack(id, signal);
  const metadata = normalizeTidalTrack(u.toString(), track);

  return metadata;
}
async function deezer(u:URL, signal?:AbortSignal){const m=base("deezer",u);if(!m.catalogId)throw new Error("Deezer track ID could not be detected");const r=await fetch("https://api.deezer.com/track/"+encodeURIComponent(m.catalogId), { signal, redirect: "error" });if(!r.ok)throw new Error("Deezer metadata request failed with HTTP "+r.status);const x=await r.json() as Record<string,unknown>;if(x.error)throw new Error("Deezer track was not found");const a=x.artist as Record<string,unknown>|undefined,b=x.album as Record<string,unknown>|undefined;m.title=String(x.title??"")||null;m.artist=String(a?.name??"")||null;m.album=String(b?.title??"")||null;m.artworkUrl=String(b?.cover_medium??"")||null;m.previewUrl=String(x.preview??"")||null;m.canonicalUrl=String(x.link??u);if(m.catalogId)m.externalIds.deezer=m.catalogId;m.raw=x;m.evidenceStatus=m.title&&m.artist?"recognized":"partial";return m;}
async function audiomack(u:URL, signal?:AbortSignal) {
  const metadata = base("audiomack", u);
  const [artistSlug, trackSlug] = (metadata.catalogId ?? "").split("/");
  if (!artistSlug || !trackSlug) throw new Error("Audiomack single-track URL could not be detected");
  const track = await new AudiomackClient().getTrackBySlug(artistSlug, trackSlug, signal);
  const uploader = track.uploader && typeof track.uploader === "object"
    ? track.uploader as Record<string, unknown> : {};
  const stringField = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  metadata.catalogId = String(track.id ?? metadata.catalogId);
  metadata.title = stringField(track.title);
  metadata.artist = stringField(track.artist) ?? stringField(uploader.name);
  metadata.album = stringField(track.album);
  metadata.genre = stringField(track.genre) ?? stringField(uploader.genre);
  metadata.label = stringField(uploader.label);
  metadata.artworkUrl = stringField(track.image);
  metadata.releaseDate = typeof track.released === "string" && /^\d+$/.test(track.released)
    ? new Date(Number(track.released) * 1000).toISOString().slice(0, 10)
    : null;
  metadata.externalIds.audiomack = metadata.catalogId;
  metadata.raw = track;
  metadata.evidenceStatus = metadata.title && metadata.artist ? "recognized" : "partial";
  return metadata;
}
async function youtube(u:URL, signal?:AbortSignal){const m=base("youtube_music",u);const r=await fetch("https://www.youtube.com/oembed?url="+encodeURIComponent(u.toString())+"&format=json", { signal, redirect: "error" });if(!r.ok)throw new Error("YouTube metadata request failed with HTTP "+r.status);const d=await r.json() as {title?:string;author_name?:string;thumbnail_url?:string};m.title=d.title??null;m.artist=d.author_name??null;m.artworkUrl=d.thumbnail_url??null;if(m.catalogId)m.externalIds.youtube=m.catalogId;m.raw=d;m.evidenceStatus=m.title&&m.artist?"recognized":"partial";return m;}

const PROVIDER_BY_PLATFORM: Partial<Record<DspPlatform, ProviderId>> = {
  spotify: "spotify", apple_music: "apple_music", deezer: "deezer",
  youtube_music: "youtube_music", tidal: "tidal", audiomack: "audiomack",
};

export async function collectCatalogMetadata(input:string, signal?:AbortSignal):Promise<CatalogMetadata>{
  signal?.throwIfAborted();
  const u=normalizeUrl(input);
  const platform=HOSTS[u.hostname.toLowerCase()];
  if (!platform || platform === "unknown") throw new Error("Unsupported DSP or catalog URL");
  if (!idFromPath(u, platform)) {
    if (platform === "tidal" && u.pathname.split("/").filter(Boolean).includes("playlist")) {
      throw new Error("TIDAL playlist URLs are not supported for single-track audits. Submit a TIDAL track URL.");
    }
    throw new Error(`${platform} track ID could not be detected`);
  }
  const provider=PROVIDER_BY_PLATFORM[platform];
  if (provider) {
    const decision=providerDecision(provider);
    if (!decision.enabled) {
      const metadata=base(platform,u);
      metadata.raw={providerPolicy:{provider,status:"unavailable",reason:"disabled by data policy",commercialStatus:decision.commercialStatus}};
      return metadata;
    }
  }
  switch(platform){case"spotify":return spotify(u,signal);case"apple_music":return apple(u,signal);case"deezer":return deezer(u,signal);case"youtube_music":return youtube(u,signal);case"tidal":return tidal(u,signal);case"audiomack":return audiomack(u,signal);default:throw new Error("Unsupported DSP or catalog URL");}
}
export function detectDspPlatform(input:string):DspPlatform{try{return HOSTS[normalizeUrl(input).hostname.toLowerCase()]??"unknown";}catch{return"unknown";}}
