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
 * grants permission. All providers are operationally authorized by the product
 * owner, but each still requires its exact opt-in flag to be "true".
 */
export const PROVIDER_POLICY = {
  groq: {
    id: "groq", commercialStatus: "allowed", termsUrl: "https://groq.com/terms-of-use/",
    attribution: "Identify Groq as the assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Verify current API retention, training and deletion terms before enabling.",
    enableFlag: "PROVIDER_ENABLED_GROQ", decisionNote: "Operational enablement explicitly authorized by the product owner; this setting is not a legal determination and does not waive applicable terms or retention obligations.",
  },
  audd: {
    id: "audd", commercialStatus: "allowed", termsUrl: "https://audd.io/terms/",
    attribution: "Name AudD and retrieval time for every recognition result.",
    retention: "Verify audio upload, transient processing, caching and deletion terms before enabling.",
    enableFlag: "PROVIDER_ENABLED_AUDD", decisionNote: "Operational enablement explicitly authorized by the product owner; this setting is not a legal determination and does not waive applicable terms, audio-processing, retention or deletion obligations.",
  },
  spotify: {
    id: "spotify", commercialStatus: "allowed", termsUrl: "https://developer.spotify.com/terms",
    attribution: "Name Spotify and retrieval time; observe Spotify display and attribution rules.",
    retention: "Apply Spotify API data refresh, deletion and storage restrictions.",
    enableFlag: "PROVIDER_ENABLED_SPOTIFY", decisionNote: "Operational use explicitly authorized by the product owner; comply with Spotify terms, display, refresh and deletion requirements.",
  },
  apple_music: {
    id: "apple_music", commercialStatus: "allowed", termsUrl: "https://developer.apple.com/musickit/",
    attribution: "Name Apple/iTunes lookup and retrieval time.",
    retention: "Verify applicable catalogue API terms, caching and attribution requirements.",
    enableFlag: "PROVIDER_ENABLED_APPLE_MUSIC", decisionNote: "Operational use explicitly authorized by the product owner; verify and comply with applicable Apple API terms, caching and attribution requirements.",
  },
  youtube_music: {
    id: "youtube_music", commercialStatus: "allowed", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    attribution: "Name YouTube oEmbed and retrieval time; preserve required attribution.",
    retention: "Verify YouTube API terms, refresh and deletion rules for any retained data.",
    enableFlag: "PROVIDER_ENABLED_YOUTUBE_MUSIC", decisionNote: "Operational use explicitly authorized by the product owner; comply with YouTube API terms, attribution, refresh and deletion requirements.",
  },
  tidal: {
    id: "tidal", commercialStatus: "allowed", termsUrl: "https://developer.tidal.com/",
    attribution: "Name TIDAL and retrieval time.",
    retention: "Verify API data storage, caching, display and deletion restrictions.",
    enableFlag: "PROVIDER_ENABLED_TIDAL", decisionNote: "Operational use explicitly authorized by the product owner; comply with applicable TIDAL API terms and data handling requirements.",
  },
  audiomack: {
    id: "audiomack", commercialStatus: "allowed", termsUrl: "https://api.audiomack.com/",
    attribution: "Name Audiomack official Data API and retrieval time.",
    retention: "Verify written commercial permission and retention terms; credentials alone are insufficient.",
    enableFlag: "PROVIDER_ENABLED_AUDIOMACK", decisionNote: "Operational use explicitly authorized by the product owner; comply with applicable Audiomack API terms and written permissions where required.",
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
    id: "lastfm", commercialStatus: "allowed", termsUrl: "https://www.last.fm/api/tos",
    attribution: "Attribute Last.fm and retrieval time.",
    retention: "Review caching, display and deletion rules before any use.",
    enableFlag: "PROVIDER_ENABLED_LASTFM",
    decisionNote: "Operational use explicitly authorized by the product owner; comply with Last.fm API terms, attribution, caching and deletion requirements.",
  },
  beat_this: {
    id: "beat_this", commercialStatus: "allowed", termsUrl: "https://github.com/CPJKU/beat_this",
    attribution: "Disclose model name, upstream commit, artifact hash and conversion provenance.",
    retention: "Do not retain submitted audio beyond analysis; document model artifact and training-data caveats.",
    enableFlag: "PROVIDER_ENABLED_BEAT_THIS", decisionNote: "Operational use explicitly authorized by the product owner; verify model artifact provenance, licence and runtime fit before deploying the model.",
  },
  fmak: {
    id: "fmak", commercialStatus: "allowed", termsUrl: "https://github.com/mdeff/fma",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Do not ingest until commercial rights and asset-level provenance are verified.",
    enableFlag: "PROVIDER_ENABLED_FMAK", decisionNote: "Operational use explicitly authorized by the product owner; verify asset-level licences and provenance before ingesting or redistributing dataset content.",
  },
  giantsteps: {
    id: "giantsteps", commercialStatus: "allowed", termsUrl: "https://www.audiolabs-erlangen.de/resources/MIR/2016-GiantSteps",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Do not ingest until commercial rights and asset-level provenance are verified.",
    enableFlag: "PROVIDER_ENABLED_GIANTSTEPS", decisionNote: "Dataset rights are unverified.",
  },
  chartmetric: {
    id: "chartmetric", commercialStatus: "allowed", termsUrl: "https://chartmetric.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_CHARTMETRIC", decisionNote: "Operational use explicitly authorized by the product owner; use only within applicable vendor agreement, attribution and data-retention terms.",
  },
  soundcharts: {
    id: "soundcharts", commercialStatus: "allowed", termsUrl: "https://soundcharts.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_SOUNDCHARTS", decisionNote: "No approved commercial agreement is recorded.",
  },
  luminate: {
    id: "luminate", commercialStatus: "allowed", termsUrl: "https://luminatedata.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
    enableFlag: "PROVIDER_ENABLED_LUMINATE", decisionNote: "No approved commercial agreement is recorded.",
  },
  essentia: {
    id: "essentia", commercialStatus: "allowed", termsUrl: "https://essentia.upf.edu/licensing_information.html",
    attribution: "Disclose Essentia and the exact model/version; preserve required licence notices and provenance.",
    retention: "Use model artifacts only under applicable licence terms; document provenance and submitted-audio handling.",
    enableFlag: "PROVIDER_ENABLED_ESSENTIA", decisionNote: "Operational use explicitly authorized by the product owner; confirm and comply with the applicable Essentia licence before distribution.",
  },
  madmom: {
    id: "madmom", commercialStatus: "allowed", termsUrl: "https://github.com/CPJKU/madmom",
    attribution: "Not applicable while disabled.",
    retention: "No code, model or data use permitted under current product policy.",
    enableFlag: "PROVIDER_ENABLED_MADMOM", decisionNote: "Denied under current product policy.",
  },
  deezer: {
    id: "deezer", commercialStatus: "allowed", termsUrl: "https://developers.deezer.com/",
    attribution: "Not applicable while disabled.",
    retention: "Follow applicable Deezer API terms for permitted collection, caching, display, refresh and deletion.",
    enableFlag: "PROVIDER_ENABLED_DEEZER", decisionNote: "Operational use explicitly authorized by the product owner; verify and comply with Deezer API permissions and applicable commercial terms.",
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

/** Fail-closed decision. Credentials never replace the exact provider opt-in flag. */
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
