export type CommercialStatus = "allowed" | "unverified" | "denied";

export interface ProviderPolicy {
  id: string;
  commercialStatus: CommercialStatus;
  termsUrl: string;
  attribution: string;
  retention: string;
  enableFlag: `PROVIDER_ENABLED_${string}`;
  requiredFlags?: readonly string[];
  decisionNote: string;
}

/**
 * This is the executable provider policy register. An API credential never
 * grants permission: a provider must be marked allowed AND its opt-in flag
 * must be exactly "true". Unverified and denied providers always fail closed.
 */
export const PROVIDER_POLICY = {
  groq: {
    id: "groq", commercialStatus: "unverified", termsUrl: "https://groq.com/terms-of-use/",
    attribution: "Identify Groq as the assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Verify current API retention, training and deletion terms before enabling.",
    enableFlag: "PROVIDER_ENABLED_GROQ", decisionNote: "Commercial processing and retention review is outstanding.",
  },
  audd: {
    id: "audd", commercialStatus: "unverified", termsUrl: "https://audd.io/terms/",
    attribution: "Name AudD and retrieval time for every recognition result.",
    retention: "Verify audio upload, transient processing, caching and deletion terms before enabling.",
    enableFlag: "PROVIDER_ENABLED_AUDD", decisionNote: "Commercial audio-processing permission is unverified.",
  },
  spotify: {
    id: "spotify", commercialStatus: "unverified", termsUrl: "https://developer.spotify.com/terms",
    attribution: "Name Spotify and retrieval time; observe Spotify display and attribution rules.",
    retention: "Apply Spotify API data refresh, deletion and storage restrictions.",
    enableFlag: "PROVIDER_ENABLED_SPOTIFY", decisionNote: "Commercial product use is not approved under this register.",
  },
  apple_music: {
    id: "apple_music", commercialStatus: "unverified", termsUrl: "https://developer.apple.com/musickit/",
    attribution: "Name Apple/iTunes lookup and retrieval time.",
    retention: "Verify applicable catalogue API terms, caching and attribution requirements.",
    enableFlag: "PROVIDER_ENABLED_APPLE_MUSIC", decisionNote: "Commercial API permission for this exact lookup workflow is unverified.",
  },
  youtube_music: {
    id: "youtube_music", commercialStatus: "unverified", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    attribution: "Name YouTube oEmbed and retrieval time; preserve required attribution.",
    retention: "Verify YouTube API terms, refresh and deletion rules for any retained data.",
    enableFlag: "PROVIDER_ENABLED_YOUTUBE_MUSIC", decisionNote: "Current oEmbed use has not been cleared for this commercial workflow.",
  },
  tidal: {
    id: "tidal", commercialStatus: "unverified", termsUrl: "https://developer.tidal.com/",
    attribution: "Name TIDAL and retrieval time.",
    retention: "Verify API data storage, caching, display and deletion restrictions.",
    enableFlag: "PROVIDER_ENABLED_TIDAL", decisionNote: "Commercial API permission is unverified.",
  },
  audiomack: {
    id: "audiomack", commercialStatus: "unverified", termsUrl: "https://api.audiomack.com/",
    attribution: "Name Audiomack official Data API and retrieval time.",
    retention: "Verify written commercial permission and retention terms; credentials alone are insufficient.",
    enableFlag: "PROVIDER_ENABLED_AUDIOMACK", decisionNote: "Written commercial permission is not established.",
  },
  deezer: {
    id: "deezer", commercialStatus: "denied", termsUrl: "https://developers.deezer.com/",
    attribution: "Not applicable while disabled.",
    retention: "No data collection permitted under current product policy.",
    enableFlag: "PROVIDER_ENABLED_DEEZER", decisionNote: "Denied under current product policy pending a new written commercial grant.",
  },
} as const satisfies Record<string, ProviderPolicy>;

export type ProviderId = keyof typeof PROVIDER_POLICY;

export interface ProviderDecision {
  provider: ProviderId;
  enabled: boolean;
  reason: string | null;
  commercialStatus: CommercialStatus;
  enableFlag: string;
}

/** Fail-closed decision. No key, credential, or flag can override policy status. */
export function providerDecision(
  provider: ProviderId,
  env: Record<string, string | undefined> = process.env,
): ProviderDecision {
  const policy = PROVIDER_POLICY[provider];
  const flagsSatisfied = env[policy.enableFlag] === "true"
    && (policy.requiredFlags ?? []).every((flag) => env[flag] === "true");
  const enabled = policy.commercialStatus === "allowed" && flagsSatisfied;
  return {
    provider,
    enabled,
    reason: enabled ? null : "disabled by data policy",
    commercialStatus: policy.commercialStatus,
    enableFlag: policy.enableFlag,
  };
}

export function assertProviderEnabled(provider: ProviderId): void {
  const decision = providerDecision(provider);
  if (!decision.enabled) {
    throw new Error(`${provider}: ${decision.reason}`);
  }
}
