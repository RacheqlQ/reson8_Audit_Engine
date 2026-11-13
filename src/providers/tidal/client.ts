interface TidalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface TidalApiClient {
  getTrack(trackId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export class TidalClient implements TidalApiClient {
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly clientId = process.env.TIDAL_CLIENT_ID,
    private readonly clientSecret = process.env.TIDAL_CLIENT_SECRET,
    private readonly countryCode = process.env.TIDAL_COUNTRY_CODE ?? "US",
  ) {
    if (!clientId || !clientSecret) {
      throw new Error("TIDAL client credentials are required");
    }
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const now = Date.now();

    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.accessToken;
    }

    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await fetch("https://auth.tidal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `TIDAL token request failed with HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as Partial<TidalTokenResponse>;

    if (
      !payload.access_token ||
      typeof payload.expires_in !== "number"
    ) {
      throw new Error("TIDAL token response was invalid");
    }

    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAt: now + payload.expires_in * 1000,
    };

    return payload.access_token;
  }

  async getTrack(trackId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const accessToken = await this.accessToken(signal);
    const params = new URLSearchParams({
      countryCode: this.countryCode,
      include: "artists,albums,genres,providers",
    });

    const response = await fetch(
      `https://openapi.tidal.com/v2/tracks/${encodeURIComponent(trackId)}?${params.toString()}`,
      {
        headers: {
          Accept: "application/vnd.api+json",
          Authorization: `Bearer ${accessToken}`,
        },
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `TIDAL track request failed with HTTP ${response.status}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
