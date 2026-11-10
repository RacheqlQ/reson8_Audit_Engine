import { SpotifyClient } from "../spotify/client.js";
import { normalizeSpotifyTrack } from "../spotify/normalize.js";
import { TidalClient } from "../tidal/client.js";
import { normalizeTidalTrack } from "../tidal/normalize.js";

export type DspPlatform = "spotify" | "apple_music" | "youtube_music" | "deezer" | "tidal" | "unknown";

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
  "open.spotify.com":"spotify","play.spotify.com":"spotify","music.apple.com":"apple_music",
  "itunes.apple.com":"apple_music","music.youtube.com":"youtube_music","youtube.com":"youtube_music",
  "www.youtube.com":"youtube_music","youtu.be":"youtube_music","deezer.com":"deezer",
  "www.deezer.com":"deezer","tidal.com":"tidal","listen.tidal.com":"tidal"
};

function normalizeUrl(input:string){const u=new URL(input.trim());if(u.protocol!=="https:")throw new Error("DSP URL must use HTTPS");if(u.username||u.password)throw new Error("DSP URL must not contain credentials");if(!HOSTS[u.hostname.toLowerCase()])throw new Error("Unsupported DSP or catalog URL");return u;}
function idFromPath(u:URL,p:DspPlatform){const a=u.pathname.split("/").filter(Boolean);if(p==="spotify"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}if(p==="apple_music"){const i=a.indexOf("i");return i>=0?a[i+1]??null:u.searchParams.get("i");}if(p==="deezer"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}if(p==="tidal"){const i=a.indexOf("track");return i>=0?a[i+1]??null:null;}return u.searchParams.get("v")??(u.hostname==="youtu.be"?a[0]??null:null);}
function base(p:DspPlatform,u:URL):CatalogMetadata{return{platform:p,sourceUrl:u.toString(),canonicalUrl:u.toString(),catalogId:idFromPath(u,p),artist:null,title:null,album:null,releaseDate:null,isrc:null,upc:null,catalogPopularity:null,catalogPopularityScale:null,label:null,genre:null,artworkUrl:null,previewUrl:null,externalIds:{},raw:{},evidenceStatus:"partial",sonicProfile:null};}

async function spotify(u:URL){
  const metadata = base("spotify", u);
  const id = metadata.catalogId;
  if (!id) throw new Error("Spotify track ID could not be detected");

  try {
    const client = new SpotifyClient();
    return await normalizeSpotifyTrack(u.toString(), await client.getTrack(id));
  } catch (error) {
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

async function apple(u:URL){const m=base("apple_music",u);if(!m.catalogId)throw new Error("Apple Music track ID could not be detected");const r=await fetch("https://itunes.apple.com/lookup?id="+encodeURIComponent(m.catalogId)+"&entity=song");if(!r.ok)throw new Error("Apple Music metadata request failed with HTTP "+r.status);const d=await r.json() as {results?:Array<Record<string,unknown>>};const x=d.results?.find(v=>v.kind==="song")??d.results?.[0];if(!x)throw new Error("Apple Music track was not found");m.canonicalUrl=String(x.trackViewUrl??u);m.artist=String(x.artistName??"")||null;m.title=String(x.trackName??"")||null;m.album=String(x.collectionName??"")||null;m.releaseDate=String(x.releaseDate??"").slice(0,10)||null;m.genre=String(x.primaryGenreName??"")||null;m.artworkUrl=String(x.artworkUrl100??"")||null;m.previewUrl=String(x.previewUrl??"")||null;m.isrc=String(x.isrc??"")||null;if(x.trackId)m.externalIds.apple_music=String(x.trackId);m.raw=x;m.evidenceStatus=m.title&&m.artist?"verified":"partial";return m;}
async function tidal(u:URL){
  const id=idFromPath(u,"tidal");
  if(!id){
    const path=u.pathname.split("/").filter(Boolean);
    if(path.includes("playlist")) throw new Error("TIDAL playlist URLs are not supported for single-track audits. Submit a TIDAL track URL.");
    throw new Error("TIDAL track ID could not be detected");
  }
  const client=new TidalClient();
  const track=await client.getTrack(id);
  const metadata = normalizeTidalTrack(u.toString(), track);

  if (metadata.isrc && (!metadata.genre || !metadata.label || metadata.catalogPopularity === null)) {
    try {
      const spotifyClient = new SpotifyClient();
      const spotifyTrack = await spotifyClient.getTrackByIsrc(metadata.isrc);
      if (!spotifyTrack) return metadata;

      const artistId = (
        spotifyTrack.artists as Array<Record<string, unknown>> | undefined
      )?.[0]?.id;

      if (typeof artistId === "string" && artistId) {
        const artist = await spotifyClient.getArtist(artistId);
        const genres = Array.isArray(artist.genres)
          ? artist.genres.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];

        return {
          ...metadata,
          genre: genres[0] ?? metadata.genre,
          catalogPopularity: metadata.catalogPopularity ?? (
            typeof spotifyTrack?.popularity === "number" && Number.isFinite(spotifyTrack.popularity)
              ? spotifyTrack.popularity
              : null
          ),
          catalogPopularityScale: metadata.catalogPopularityScale ?? (
            typeof spotifyTrack?.popularity === "number" && Number.isFinite(spotifyTrack.popularity)
              ? "0_100"
              : null
          ),
          externalIds: {
            ...metadata.externalIds,
            ...(typeof spotifyTrack.id === "string" ? { spotify: spotifyTrack.id } : {}),
          },
          raw: {
            ...metadata.raw,
            crossReferences: {
              spotify: {
                id: typeof spotifyTrack.id === "string" ? spotifyTrack.id : null,
                artistId,
                genres,
              },
            },
          },
        };
      }
    } catch {
      // TIDAL remains authoritative when optional Spotify enrichment is unavailable.
    }
  }

  return metadata;
}
async function deezer(u:URL){const m=base("deezer",u);if(!m.catalogId)throw new Error("Deezer track ID could not be detected");const r=await fetch("https://api.deezer.com/track/"+encodeURIComponent(m.catalogId));if(!r.ok)throw new Error("Deezer metadata request failed with HTTP "+r.status);const x=await r.json() as Record<string,unknown>;if(x.error)throw new Error("Deezer track was not found");const a=x.artist as Record<string,unknown>|undefined,b=x.album as Record<string,unknown>|undefined;m.title=String(x.title??"")||null;m.artist=String(a?.name??"")||null;m.album=String(b?.title??"")||null;m.artworkUrl=String(b?.cover_medium??"")||null;m.previewUrl=String(x.preview??"")||null;m.canonicalUrl=String(x.link??u);if(m.catalogId)m.externalIds.deezer=m.catalogId;m.raw=x;m.evidenceStatus=m.title&&m.artist?"verified":"partial";return m;}
async function youtube(u:URL){const m=base("youtube_music",u);const r=await fetch("https://www.youtube.com/oembed?url="+encodeURIComponent(u.toString())+"&format=json");if(!r.ok)throw new Error("YouTube metadata request failed with HTTP "+r.status);const d=await r.json() as {title?:string;author_name?:string;thumbnail_url?:string};m.title=d.title??null;m.artist=d.author_name??null;m.artworkUrl=d.thumbnail_url??null;if(m.catalogId)m.externalIds.youtube=m.catalogId;m.raw=d;m.evidenceStatus=m.title&&m.artist?"verified":"partial";return m;}

export async function collectCatalogMetadata(input:string):Promise<CatalogMetadata>{const u=normalizeUrl(input);switch(HOSTS[u.hostname.toLowerCase()]){case"spotify":return spotify(u);case"apple_music":return apple(u);case"deezer":return deezer(u);case"youtube_music":return youtube(u);case"tidal":return tidal(u);default:throw new Error("Unsupported DSP or catalog URL");}}
export function detectDspPlatform(input:string):DspPlatform{try{return HOSTS[normalizeUrl(input).hostname.toLowerCase()]??"unknown";}catch{return"unknown";}}
