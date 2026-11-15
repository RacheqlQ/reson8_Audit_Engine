export type DspTrackPlatform = "spotify" | "apple_music" | "deezer" | "tidal" | "youtube_music" | "audiomack";

export interface NormalizedDspTrackLink {
  platform: DspTrackPlatform;
  catalogId: string;
  canonicalUrl: string;
}

const TRACK_HOSTS: Readonly<Record<string, DspTrackPlatform>> = Object.freeze({
  "open.spotify.com": "spotify",
  "play.spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "itunes.apple.com": "apple_music",
  "www.deezer.com": "deezer",
  "deezer.com": "deezer",
  "tidal.com": "tidal",
  "listen.tidal.com": "tidal",
  "music.youtube.com": "youtube_music",
  "audiomack.com": "audiomack",
  "www.audiomack.com": "audiomack",
});

function requireTrackId(value: string | null | undefined): string {
  const id = value?.trim() ?? "";
  if (!id || id.length > 160 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Only individual DSP track links are supported");
  }
  return id;
}

function normalizeOne(input: string): NormalizedDspTrackLink {
  if (typeof input !== "string" || input.length > 2048) {
    throw new Error("DSP track URL is invalid");
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("DSP track URL is invalid");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("DSP URL must be a credential-free HTTPS link on a supported host");
  }

  const host = url.hostname.toLowerCase();
  const platform = TRACK_HOSTS[host];
  if (!platform) {
    throw new Error("Unsupported DSP or catalog URL");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  let catalogId: string;
  let canonicalUrl: string;

  switch (platform) {
    case "spotify": {
      const index = segments.indexOf("track");
      catalogId = requireTrackId(index >= 0 ? segments[index + 1] : null);
      canonicalUrl = `https://open.spotify.com/track/${catalogId}`;
      break;
    }
    case "apple_music": {
      const index = segments.indexOf("album");
      const albumId = index >= 0 ? segments[index + 2] : null;
      catalogId = requireTrackId(url.searchParams.get("i"));
      if (!albumId || !/^\d+$/.test(albumId)) {
        throw new Error("Only individual DSP track links are supported");
      }
      const locale = segments[0] && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0]) ? segments[0] : "us";
      const slug = segments[index + 1] && !/^\d+$/.test(segments[index + 1]) ? segments[index + 1] : "track";
      canonicalUrl = `https://music.apple.com/${locale}/album/${slug}/${albumId}?i=${catalogId}`;
      break;
    }
    case "deezer": {
      const index = segments.indexOf("track");
      catalogId = requireTrackId(index >= 0 ? segments[index + 1] : null);
      canonicalUrl = `https://www.deezer.com/track/${catalogId}`;
      break;
    }
    case "tidal": {
      const index = segments.indexOf("track");
      catalogId = requireTrackId(index >= 0 ? segments[index + 1] : null);
      canonicalUrl = `https://tidal.com/browse/track/${catalogId}`;
      break;
    }
    case "audiomack": {
      if (!(segments.length === 2 || (segments.length === 3 && segments[1] === "song"))) {
        throw new Error("Only individual DSP track links are supported");
      }
      const artistSlug = segments[0];
      const trackSlug = segments[1] === "song" ? segments[2] : segments[1];
      catalogId = `${requireTrackId(artistSlug)}/${requireTrackId(trackSlug)}`;
      canonicalUrl = `https://audiomack.com/${artistSlug}/song/${trackSlug}`;
      break;
    }
    case "youtube_music": {
      const id = host === "youtu.be"
        ? segments[0]
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : null;
      catalogId = requireTrackId(id);
      const canonicalHost = host === "music.youtube.com" ? "music.youtube.com" : "www.youtube.com";
      canonicalUrl = `https://${canonicalHost}/watch?v=${catalogId}`;
      break;
    }
  }

  return { platform, catalogId, canonicalUrl };
}

export function normalizeDspTrackLinks(inputs: readonly string[]): NormalizedDspTrackLink[] {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("Provide at least one DSP track link");
  }
  if (inputs.length > 8) {
    throw new Error("A maximum of 8 DSP track links is allowed");
  }

  const unique = new Map<string, NormalizedDspTrackLink>();
  const platformTrack = new Map<DspTrackPlatform, string>();
  for (const input of inputs) {
    const link = normalizeOne(input);
    const priorTrack = platformTrack.get(link.platform);
    if (priorTrack && priorTrack !== link.catalogId) {
      throw new Error("Only one distinct track per DSP platform is allowed in a single audit");
    }
    platformTrack.set(link.platform, link.catalogId);
    const key = `${link.platform}:${link.catalogId}`;
    if (!unique.has(key)) unique.set(key, link);
  }
  return [...unique.values()];
}
