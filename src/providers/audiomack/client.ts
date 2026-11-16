import { createHmac, randomBytes } from "node:crypto";

function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class AudiomackClient {
  constructor(
    private readonly consumerKey = process.env.AUDIOMACK_CONSUMER_KEY,
    private readonly consumerSecret = process.env.AUDIOMACK_CONSUMER_SECRET,
  ) {}

  async getTrackBySlug(artistSlug: string, trackSlug: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    if (!this.consumerKey || !this.consumerSecret) {
      throw new Error("Audiomack official API credentials are not configured");
    }
    if (!/^[a-z0-9-]{1,100}$/i.test(artistSlug) || !/^[a-z0-9-]{1,140}$/i.test(trackSlug)) {
      throw new Error("Audiomack track URL contains an invalid artist or track slug");
    }

    const url = new URL(
      `https://api.audiomack.com/v1/music/song/${encodeURIComponent(artistSlug)}/${encodeURIComponent(trackSlug)}`,
    );
    const fields = "id,type,title,artist,album,released,genre,image,uploader:name,uploader:label,uploader:genre,uploader:url_slug";
    url.searchParams.set("fields", fields);
    const oauth = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: "1.0",
    };
    const normalizedParameters = Object.entries({ ...oauth, fields })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${oauthEncode(key)}=${oauthEncode(value)}`)
      .join("&");
    const baseString = [
      "GET",
      oauthEncode(url.origin + url.pathname),
      oauthEncode(normalizedParameters),
    ].join("&");
    const signingKey = `${oauthEncode(this.consumerSecret)}&`;
    const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");
    const authorization = "OAuth " + Object.entries({ ...oauth, oauth_signature: signature })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
      .join(", ");

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorization },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Audiomack official API request failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as { results?: unknown };
    const result = payload.results && typeof payload.results === "object"
      ? payload.results as Record<string, unknown>
      : null;
    if (!result || result.type !== "song") {
      throw new Error("Audiomack official API did not return a single song");
    }
    const uploader = result.uploader && typeof result.uploader === "object"
      ? result.uploader as Record<string, unknown> : {};
    return {
      id: result.id,
      type: "song",
      title: result.title,
      artist: result.artist,
      album: result.album,
      released: result.released,
      genre: result.genre,
      image: result.image,
      uploader: {
        name: uploader.name,
        label: uploader.label,
        genre: uploader.genre,
        url_slug: uploader.url_slug,
      },
    };
  }
}
