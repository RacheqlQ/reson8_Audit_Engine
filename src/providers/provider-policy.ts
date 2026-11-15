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
    id: "groq", commercialStatus: "allowed", termsUrl: "https://groq.com/terms-of-use/",
    attribution: "Identify Groq as the assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Verify current API retention, training and deletion terms before enabling.",
    enableFlag: "PROVIDER_ENABLED_GROQ", decisionNote: "Operational enablement explicitly authorized by the product owner; this setting is not a legal determination and does not waive applicable terms or retention obligations.",
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
  musicbrainz: {
    id: "musicbrainz", commercialStatus: "allowed", termsUrl: "https://musicbrainz.org/doc/MusicBrainz_Database/License",
    attribution: "Attribute MusicBrainz and identify the accessed database/API fields.",
    retention: "Respect database licence, API rate limits and applicable caching rules.",
    enableFlag: "PROVIDER_ENABLED_MUSICBRAINZ", decisionNote: "Allowed subject to attribution, descriptive User-Agent and one request per second.",
  },
  listenbrainz: {
    id: "listenbrainz", commercialStatus: "allowed", termsUrl: "https://github.com/metabrainz/listenbrainz-server",
    attribution: "Attribute ListenBrainz and distinguish incomplete public listening data from market share.",
    retention: "Respect API limits and applicable data handling requirements.",
    enableFlag: "PROVIDER_ENABLED_LISTENBRAINZ", decisionNote: "Allowed with attribution and rate-limit controls.",
  },
  youtube_data_api: {
    id: "youtube_data_api", commercialStatus: "allowed", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    attribution: "Attribute YouTube and preserve required API branding and source context.",
    retention: "Apply YouTube API refresh, deletion and storage rules.",
    enableFlag: "PROVIDER_ENABLED_YOUTUBE", decisionNote: "Allowed only within API Services Terms and Developer Policies.",
  },
  lastfm: {
    id: "lastfm", commercialStatus: "unverified", termsUrl: "https://www.last.fm/api/tos",
    attribution: "Attribute Last.fm and retrieval time.",
    retention: "Review caching, display and deletion rules before any use.",
    enableFlag: "PROVIDER_ENABLED_LASTFM", requiredFlags: ["LASTFM_COMMERCIAL_AGREEMENT"],
    decisionNote: "Requires a verified commercial agreement; the additional flag alone cannot override unverified status.",
  },
  beat_this: {
    id: "beat_this", commercialStatus: "unverified", termsUrl: "https://github.com/CPJKU/beat_this",
    attribution: "Disclose model name, upstream commit, artifact hash and conversion provenance.",
    retention: "Do not retain submitted audio beyond analysis; document model artifact and training-data caveats.",
    enableFlag: "PROVIDER_ENABLED_BEAT_THIS", decisionNote: "Blocked pending artifact provenance and measured 512 MB runtime fit.",
  },
  fmak: {
    id: "fmak", commercialStatus: "unverified", termsUrl: "https://github.com/mdeff/fma",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Do not ingest until commercial rights and asset-level provenance are verified.",
    enableFlag: "PROVIDER_ENABLED_FMAK", decisionNote: "Dataset rights are unverified.",
  },
  giantsteps: {
    id: "giantsteps", commercialStatus: "unverified", termsUrl: "https://www.audiolabs-erlangen.de/resources/MIR/2016-GiantSteps",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Do not ingest until commercial rights and asset-level provenance are verified.",
    enableFlag: "PROVIDER_ENABLED_GIANTSTEPS", decisionNote: "Dataset rights are unverified.",
  },
  chartmetric: {
    id: "chartmetric", commercialStatus: "unverified", termsUrl: "https://chartmetric.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_CHARTMETRIC", decisionNote: "No approved commercial agreement is recorded.",
  },
  soundcharts: {
    id: "soundcharts", commercialStatus: "unverified", termsUrl: "https://soundcharts.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_SOUNDCHARTS", decisionNote: "No approved commercial agreement is recorded.",
  },
  luminate: {
    id: "luminate", commercialStatus: "unverified", termsUrl: "https://luminatedata.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_LUMINATE", decisionNote: "No approved commercial agreement is recorded.",
  },
  essentia: {
    id: "essentia", commercialStatus: "denied", termsUrl: "https://essentia.upf.edu/licensing_information.html",
    attribution: "Not applicable while disabled.",
    retention: "No code, model or data use permitted under current product policy.",
    enableFlag: "PROVIDER_ENABLED_ESSENTIA", decisionNote: "Denied under current product policy.",
  },
  madmom: {
    id: "madmom", commercialStatus: "denied", termsUrl: "https://github.com/CPJKU/madmom",
    attribution: "Not applicable while disabled.",
    retention: "No code, model or data use permitted under current product policy.",
    enableFlag: "PROVIDER_ENABLED_MADMOM", decisionNote: "Denied under current product policy.",
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
  const policy: ProviderPolicy = PROVIDER_POLICY[provider];
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
