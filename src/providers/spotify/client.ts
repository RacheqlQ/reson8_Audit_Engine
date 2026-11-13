interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface SpotifyErrorPayload {
  error?: {
    status?: number;
    message?: string;
    reason?: string;
  };
}

export interface SpotifyApiClient {
  getTrack(trackId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getTrackByIsrc(isrc: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>;
  getArtist(artistId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export class SpotifyClient implements SpotifyApiClient {
  private cachedToken: CachedToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(
    private readonly clientId = process.env.SPOTIFY_CLIENT_ID,
    private readonly clientSecret = process.env.SPOTIFY_CLIENT_SECRET,
    private readonly market = process.env.SPOTIFY_MARKET ?? "US",
  ) {
    if (!clientId || !clientSecret) {
      throw new Error("Spotify client credentials are required");
    }
  }

  private clearToken(): void {
    this.cachedToken = null;
  }

  private async fetchAccessToken(force = false, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const now = Date.now();

    if (
      !force &&
      this.cachedToken &&
      this.cachedToken.expiresAt > now + 60_000
    ) {
      return this.cachedToken.accessToken;
    }

    // Prevent concurrent jobs from requesting multiple Spotify tokens.
    if (!force && !signal && this.tokenRequest) {
      return this.tokenRequest;
    }

    const request = this.requestAccessToken(signal);

    if (!force && !signal) {
      this.tokenRequest = request;
    }

    try {
      return await request;
    } finally {
      if (!force && !signal) {
        this.tokenRequest = null;
      }
    }
  }

  private async requestAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }).toString(),
      signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | Partial<SpotifyTokenResponse>
      | SpotifyErrorPayload
      | null;

    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error
          ? String(payload.error.message)
          : "unknown Spotify OAuth error";

      throw new Error(
        `Spotify token request failed with HTTP ${response.status}: ${message}`,
      );
    }

    if (
      !payload ||
      !("access_token" in payload) ||
      typeof payload.access_token !== "string" ||
      !("expires_in" in payload) ||
      typeof payload.expires_in !== "number" ||
      payload.expires_in <= 0
    ) {
      throw new Error("Spotify token response was invalid");
    }

    this.cachedToken = {
      accessToken: payload.access_token,
      // Refresh one minute before Spotify's advertised expiry.
      expiresAt: Date.now() + payload.expires_in * 1000,
    };

    return payload.access_token;
  }

  private async spotifyRequest<T>(
    url: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    let accessToken = await this.fetchAccessToken(false, signal);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
        },
        signal,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const payload = (await response.json().catch(() => null)) as
        | SpotifyErrorPayload
        | null;

      // A 401 means the bearer token is no longer accepted. Discard the
      // cached token and obtain a completely new Client Credentials token.
      if (response.status === 401 && attempt === 0) {
        this.clearToken();
        accessToken = await this.fetchAccessToken(true, signal);
        continue;
      }

      const spotifyMessage =
        payload?.error?.message ?? "unknown Spotify API error";
      const spotifyReason = payload?.error?.reason
        ? `; reason=${payload.error.reason}`
        : "";

      if (response.status === 403) {
        throw new Error(
          `Spotify API returned HTTP 403 Forbidden for ${url}. ` +
            `Spotify message: ${spotifyMessage}${spotifyReason}. ` +
            "If the Spotify app is in Development Mode, verify that the " +
            "Spotify account associated with this application is Premium " +
            "and allowlisted in Spotify Developer Dashboard > Users Management. " +
            "A token refresh cannot bypass a Development Mode allowlist restriction.",
        );
      }

      throw new Error(
        `Spotify API request failed with HTTP ${response.status}: ${spotifyMessage}${spotifyReason}`,
      );
    }

    throw new Error("Spotify request retry loop exhausted");
  }

  async getTrackByIsrc(
    isrc: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const normalizedIsrc = isrc.trim().replace(/-/g, "");
    const params = new URLSearchParams({
      q: `isrc:${normalizedIsrc}`,
      type: "track",
      market: this.market,
      limit: "1",
    });

    const payload = await this.spotifyRequest<{
      tracks?: { items?: Array<Record<string, unknown>> };
    }>(
      `https://api.spotify.com/v1/search?${params.toString()}`,
      {},
      signal,
    );

    return payload.tracks?.items?.[0] ?? null;
  }

  async getArtist(artistId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.spotifyRequest<Record<string, unknown>>(
      `https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}`,
      {},
      signal,
    );
  }

  async getTrack(trackId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ market: this.market });

    return this.spotifyRequest<Record<string, unknown>>(
      `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}?${params.toString()}`,
      {},
      signal,
    );
  }
}
