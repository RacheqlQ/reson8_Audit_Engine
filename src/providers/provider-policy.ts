export type CommercialStatus = "allowed" | "unverified" | "denied";

export interface ProviderPolicy {
  id: string;
  commercialStatus: CommercialStatus;
  termsUrl: string;
  attribution: string;
  retention: string;
  decisionNote: string;
}

/**
 * Executable provider policy register. Provider authorization is determined
 * by the reviewed registry status; credentials are checked separately by each
 * integration. There are no per-provider environment enable switches.
 */
export const PROVIDER_POLICY = {
  groq: {
    id: "groq", commercialStatus: "allowed", termsUrl: "https://groq.com/terms-of-use/",
    attribution: "Identify Groq as the assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Follow current API retention, training and deletion terms for every request.",
decisionNote: "Operational enablement explicitly authorized by the product owner; this setting is not a legal determination and does not waive applicable terms or retention obligations.",
  },
  gemini: {
    id: "gemini", commercialStatus: "allowed", termsUrl: "https://ai.google.dev/gemini-api/terms",
    attribution: "Identify Google Gemini as the fallback assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Follow current Gemini API retention, training, regional processing and deletion terms for every request.",
decisionNote: "Available when GEMINI_API_KEY is configured; verify applicable Google AI terms and data handling.",
  },
  ollama: {
    id: "ollama", commercialStatus: "allowed", termsUrl: "https://ollama.com/terms",
    attribution: "Identify Ollama Cloud and the selected model as the fallback assessment processor in internal provenance; do not attribute generated analysis as an observed source.",
    retention: "Follow current Ollama Cloud data handling, retention, training and deletion terms for every request.",
decisionNote: "Available when OLLAMA_API_KEY is configured; use only the hosted cloud API from the embedded worker.",
  },
  audd: {
    id: "audd", commercialStatus: "allowed", termsUrl: "https://audd.io/terms/",
    attribution: "Name AudD and retrieval time for every recognition result.",
    retention: "Follow current audio upload, transient processing, caching and deletion terms for every request.",
decisionNote: "Operational enablement explicitly authorized by the product owner; this setting is not a legal determination and does not waive applicable terms, audio-processing, retention or deletion obligations.",
  },
  spotify: {
    id: "spotify", commercialStatus: "allowed", termsUrl: "https://developer.spotify.com/terms",
    attribution: "Name Spotify and retrieval time; observe Spotify display and attribution rules.",
    retention: "Apply Spotify API data refresh, deletion and storage restrictions.",
decisionNote: "Operational use explicitly authorized by the product owner; comply with Spotify terms, display, refresh and deletion requirements.",
  },
  apple_music: {
    id: "apple_music", commercialStatus: "allowed", termsUrl: "https://developer.apple.com/musickit/",
    attribution: "Name Apple/iTunes lookup and retrieval time.",
    retention: "Follow applicable catalogue API terms, caching and attribution requirements.",
decisionNote: "Operational use explicitly authorized by the product owner; verify and comply with applicable Apple API terms, caching and attribution requirements.",
  },
  youtube_music: {
    id: "youtube_music", commercialStatus: "allowed", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    attribution: "Name YouTube oEmbed and retrieval time; preserve required attribution.",
    retention: "Follow YouTube API terms, refresh and deletion rules for any retained data.",
decisionNote: "Operational use explicitly authorized by the product owner; comply with YouTube API terms, attribution, refresh and deletion requirements.",
  },
  tidal: {
    id: "tidal", commercialStatus: "allowed", termsUrl: "https://developer.tidal.com/",
    attribution: "Name TIDAL and retrieval time.",
    retention: "Follow API data storage, caching, display and deletion restrictions.",
decisionNote: "Operational use explicitly authorized by the product owner; comply with applicable TIDAL API terms and data handling requirements.",
  },
  audiomack: {
    id: "audiomack", commercialStatus: "allowed", termsUrl: "https://api.audiomack.com/",
    attribution: "Name Audiomack official Data API and retrieval time.",
    retention: "Verify written commercial permission and retention terms; credentials alone are insufficient.",
decisionNote: "Operational use explicitly authorized by the product owner; comply with applicable Audiomack API terms and written permissions where required.",
  },
  musicbrainz: {
    id: "musicbrainz", commercialStatus: "allowed", termsUrl: "https://musicbrainz.org/doc/MusicBrainz_Database/License",
    attribution: "Attribute MusicBrainz and identify the accessed database/API fields.",
    retention: "Respect database licence, API rate limits and applicable caching rules.",
decisionNote: "Allowed subject to attribution, descriptive User-Agent and one request per second.",
  },
  listenbrainz: {
    id: "listenbrainz", commercialStatus: "allowed", termsUrl: "https://github.com/metabrainz/listenbrainz-server",
    attribution: "Attribute ListenBrainz and distinguish incomplete public listening data from market share.",
    retention: "Respect API limits and applicable data handling requirements.",
decisionNote: "Allowed with attribution and rate-limit controls.",
  },
  youtube_data_api: {
    id: "youtube_data_api", commercialStatus: "allowed", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    attribution: "Attribute YouTube and preserve required API branding and source context.",
    retention: "Apply YouTube API refresh, deletion and storage rules.",
decisionNote: "Allowed only within API Services Terms and Developer Policies.",
  },
  lastfm: {
    id: "lastfm", commercialStatus: "allowed", termsUrl: "https://www.last.fm/api/tos",
    attribution: "Attribute Last.fm and retrieval time.",
    retention: "Follow caching, display and deletion rules for every use.",
decisionNote: "Operational use explicitly authorized by the product owner; comply with Last.fm API terms, attribution, caching and deletion requirements.",
  },
  beat_this: {
    id: "beat_this", commercialStatus: "allowed", termsUrl: "https://github.com/CPJKU/beat_this",
    attribution: "Disclose model name, upstream commit, artifact hash and conversion provenance.",
    retention: "Limit submitted-audio retention to what the applicable model licence and documented processing purpose permit; record artifact and training-data provenance.",
decisionNote: "Operationally authorized by the product owner; only use an identified artifact whose applicable licence, training-data provenance and runtime compatibility permit this deployment.",
  },
  fmak: {
    id: "fmak", commercialStatus: "allowed", termsUrl: "https://github.com/mdeff/fma",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Record dataset version and asset-level source/licence; use and retain each asset only as its licence permits.",
decisionNote: "Operationally authorized by the product owner; only ingest or use individual assets whose provenance and licence permit the intended commercial use.",
  },
  giantsteps: {
    id: "giantsteps", commercialStatus: "allowed", termsUrl: "https://www.audiolabs-erlangen.de/resources/MIR/2016-GiantSteps",
    attribution: "Record dataset version and per-asset source/licence where used.",
    retention: "Record dataset version and asset-level source/licence; use and retain each asset only as its licence permits.",
decisionNote: "Operationally authorized by the product owner; only ingest or use individual assets whose provenance and licence permit the intended commercial use.",
  },
  chartmetric: {
    id: "chartmetric", commercialStatus: "allowed", termsUrl: "https://chartmetric.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
decisionNote: "Operational use explicitly authorized by the product owner; use only within applicable vendor agreement, attribution and data-retention terms.",
  },
  soundcharts: {
    id: "soundcharts", commercialStatus: "allowed", termsUrl: "https://soundcharts.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
decisionNote: "Operational use explicitly authorized by the product owner; use only within applicable vendor agreement, attribution and data-retention terms.",
  },
  luminate: {
    id: "luminate", commercialStatus: "allowed", termsUrl: "https://luminatedata.com/",
    attribution: "Attribute vendor and retrieval date under an executed commercial agreement.",
    retention: "Follow contract-specific storage, caching and deletion clauses.",
decisionNote: "Operational use explicitly authorized by the product owner; use only within applicable vendor agreement, attribution and data-retention terms.",
  },
  essentia: {
    id: "essentia", commercialStatus: "allowed", termsUrl: "https://essentia.upf.edu/licensing_information.html",
    attribution: "Disclose Essentia and the exact model/version; preserve required licence notices and provenance.",
    retention: "Use model artifacts only under applicable licence terms; document provenance and submitted-audio handling.",
decisionNote: "Operationally authorized by the product owner; use only a version and model artifact whose applicable licence permits this product and deployment; preserve all licence notices and obligations.",
  },
  madmom: {
    id: "madmom", commercialStatus: "allowed", termsUrl: "https://github.com/CPJKU/madmom",
    attribution: "Disclose Madmom and the exact model/version; preserve required licence notices and provenance.",
    retention: "Use model artifacts only under applicable licence terms; document provenance and submitted-audio handling.",
decisionNote: "Denied pending a commercially compatible licence for this product.",
  },
  deezer: {
    id: "deezer", commercialStatus: "allowed", termsUrl: "https://developers.deezer.com/",
    attribution: "Attribute Deezer and retrieval time; preserve required API branding and source context.",
    retention: "Follow applicable Deezer API terms for permitted collection, caching, display, refresh and deletion.",
decisionNote: "Operational use explicitly authorized by the product owner; use the implemented public track-metadata endpoint only within Deezer API terms, rate limits and applicable restrictions.",
  },
} as const satisfies Record<string, ProviderPolicy>;

export type ProviderId = keyof typeof PROVIDER_POLICY;

export interface ProviderDecision {
  provider: ProviderId;
  enabled: boolean;
  reason: string | null;
  commercialStatus: CommercialStatus;
}

/** Fail-closed decision based on the reviewed registry status. */
export function providerDecision(provider: ProviderId): ProviderDecision {
  const policy: ProviderPolicy = PROVIDER_POLICY[provider];
  const enabled = policy.commercialStatus === "allowed";
  return {
    provider,
    enabled,
    reason: enabled ? null : "disabled by data policy",
    commercialStatus: policy.commercialStatus,
  };
}

type AssessmentProviderId = "groq" | "gemini" | "ollama";
type RuntimeUnavailableReason = "auth_error" | "daily_capacity";
const runtimeUnavailable = new Map<AssessmentProviderId, { reason: RuntimeUnavailableReason; until: number }>();

export function markAssessmentProviderUnavailable(provider: AssessmentProviderId, reason: RuntimeUnavailableReason, until = Number.POSITIVE_INFINITY): void {
  runtimeUnavailable.set(provider, { reason, until });
}

export function clearAssessmentProviderUnavailable(): void {
  runtimeUnavailable.clear();
}

export interface AssessmentProviderReadiness {
  provider: "groq" | "gemini" | "ollama";
  model: string;
  enabled: boolean;
  configured: boolean;
  usable: boolean;
  reason: "disabled_by_data_policy" | "not_configured" | "auth_error" | "daily_capacity" | null;
}

export function getAssessmentProviderReadiness(env: Record<string, string | undefined> = process.env): AssessmentProviderReadiness[] {
  const specs = [
    { provider: "groq" as const, key: env.GROQ_API_KEY ?? env.GROQ_API, model: env.GROQ_MODEL ?? "openai/gpt-oss-120b" },
    { provider: "gemini" as const, key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? "gemini-3.5-flash-lite" },
    { provider: "ollama" as const, key: env.OLLAMA_API_KEY, model: env.OLLAMA_MODEL ?? "gemma4:31b" },
  ];
  return specs.map((spec) => {
    const enabled = providerDecision(spec.provider).enabled;
    const configured = typeof spec.key === "string" && spec.key.trim().length > 0;
    const runtime = runtimeUnavailable.get(spec.provider);
    if (runtime && runtime.until <= Date.now()) runtimeUnavailable.delete(spec.provider);
    const activeRuntime = runtimeUnavailable.get(spec.provider);
    const usable = enabled && configured && !activeRuntime;
    const reason = activeRuntime?.reason ?? (usable ? null : enabled ? "not_configured" : "disabled_by_data_policy");
    return { provider: spec.provider, model: spec.model, enabled, configured, usable, reason };
  });
}
export function assertProviderEnabled(provider: ProviderId): void {
  const decision = providerDecision(provider);
  if (!decision.enabled) {
    throw new Error(`${provider}: ${decision.reason}`);
  }
}
