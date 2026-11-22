export type StrategyStatus = "available" | "unavailable" | "review_required" | "blocked";

export interface MarketPlacementInput {
  executionMode: "master" | "combined" | "dsp_link";
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  playlistDiscovery?: unknown;
}

export interface PlaylistTarget {
  rank: number;
  provider: string;
  name: string;
  url: string;
  retrievedAt: string | null;
  matchStatus: "isrc_present" | "isrc_not_found" | "membership_unverified";
  priorityScore: number;
  matchBasis: string[];
  limitations: string[];
}

export interface TerritoryPriorities {
  status: "available" | "unavailable";
  reason: string;
  provider: string | null;
  metric: string | null;
  reportingPeriod: string | null;
  retrievedAt: string | null;
  territories: Array<{ countryCode: string; value: number }>;
}

export interface ShortFormHooks {
  status: "available" | "unavailable";
  method: string;
  segments: Array<{
    startSeconds: number;
    endSeconds: number;
    score: number;
    scoreType: "relative_signal_peak_priority";
    signals: string[];
  }>;
  limitations: string[];
}

export interface PositioningRecommendation {
  status: "review_required" | "blocked";
  reason: string;
  basis: string[];
  limitations: string[];
}

export interface IsrcStrategyRoute {
  status: "available" | "pending_verification";
  route: "ISRC_FIRST" | "NON_ISRC_FALLBACK";
  isrc: string | null;
  source: string | null;
  conflicts: string[];
  nonIsrcEvidence: string[];
  requiredActions: string[];
}

export interface MarketPlacementPlan {
  version: "market-placement-v1";
  isrcStrategy: IsrcStrategyRoute;
  playlistPresence: PlaylistTarget[];
  playlistTargets: PlaylistTarget[];
  acousticSimilarity: { status: "unavailable"; reason: string };
  territoryPriorities: TerritoryPriorities;
  shortFormHooks: ShortFormHooks;
  positioning: {
    dj: PositioningRecommendation;
    club: PositioningRecommendation;
    sync: PositioningRecommendation;
  };
  rollout: Array<{
    phase: "pre_release" | "release_window" | "post_release";
    actions: string[];
    gates: string[];
  }>;
  globalLimitations: string[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

function normalizedValidIsrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(normalized) ? normalized : null;
}

function collectNonIsrcEvidence(evidence:Record<string,unknown>,sonicDna:Record<string,unknown>|null):string[]{
  const audio=record(sonicDna),rhythm=record(audio.rhythmFeatures),harmonic=record(audio.harmonicFeatures);
  const tags=record(evidence.id3),identity=record(evidence.identity),genre=record(evidence.genreClassification);
  return unique([
    ...(finite(audio.bpm)?["measured tempo"]:[]),
    ...(Array.isArray(rhythm.candidateBpms)&&rhythm.candidateBpms.length?["provisional tempo candidates"]:[]),
    ...(Array.isArray(harmonic.topCandidates)&&harmonic.topCandidates.length?["provisional tonal candidates"]:[]),
    ...(finite(audio.loudnessLufs)?["integrated loudness"]:[]),
    ...(finite(audio.loudnessRangeLu)?["loudness range"]:[]),
    ...(finite(audio.sampleRate)?["sample rate and audio format"]:[]),
    ...(Object.values(tags).some(value=>typeof value==="string"&&value.trim())?["embedded audio tags"]:[]),
    ...(clean(evidence.filename)?["uploaded filename metadata"]:[]),
    ...(clean(evidence.title??identity.title)?["supplied track title"]:[]),
    ...(clean(evidence.artist??identity.artist)?["supplied artist name"]:[]),
    ...(clean(evidence.genre??genre.primaryGenre)?["genre or lane hypotheses"]:[]),
    ...([evidence.releaseContext,evidence.campaignContext,evidence.album,identity.album,evidence.label,evidence.releaseDate].some(value=>Boolean(clean(value)))?["supplied release or campaign context"]:[]),
  ]);
}

export function resolveIsrcStrategyRoute(evidence:Record<string,unknown>,sonicDna:Record<string,unknown>|null):IsrcStrategyRoute{
  const identity=record(evidence.identity),userInput=record(evidence.userInput),recognition=record(evidence.recognition);
  const id3=record(evidence.id3),catalogMetadata=record(evidence.catalogMetadata);
  const candidates:Array<{value:unknown;source:string}>=[
    {value:evidence.isrc,source:clean(record(evidence.fieldProvenance).isrc)||"reconciled track evidence"},
    {value:identity.isrc,source:"reconciled identity"},
    {value:userInput.isrc,source:"user input"},
    {value:recognition.isrc,source:"provider recognition"},
    {value:catalogMetadata.isrc,source:"catalog metadata"},
    {value:id3.isrc,source:"embedded ID3 tags"},
  ];
  const normalizedCandidates=unique([
    ...candidates.map(candidate=>normalizedValidIsrc(candidate.value)??""),
    ...(Array.isArray(evidence.isrcCandidates)?evidence.isrcCandidates.map(value=>normalizedValidIsrc(value)??""):[]),
  ]);
  const conflicts=normalizedCandidates.filter(Boolean);
  const nonIsrcEvidence=collectNonIsrcEvidence(evidence,sonicDna);
  if(evidence.isrcConflict===true||conflicts.length>1){
    return {
      status:"pending_verification",route:"NON_ISRC_FALLBACK",isrc:null,source:null,conflicts,
      nonIsrcEvidence,
      requiredActions:[
        "Conflicting valid ISRC claims were supplied; resolve the canonical recording code before treating any catalog result as a match.",
        "Use available non-ISRC audio, metadata and campaign evidence only for provisional A&R guidance while the identifier conflict remains open.",
        "Reconcile title, artist, label, album, release date and rights or clearance records before external pitching or wide distribution.",
      ],
    };
  }
  const match=candidates.map(candidate=>({...candidate,isrc:normalizedValidIsrc(candidate.value)}))
    .find(candidate=>candidate.isrc!==null);
  if(match?.isrc){
    return {
      status:"available",route:"ISRC_FIRST",isrc:match.isrc,source:match.source,conflicts:[],nonIsrcEvidence,
      requiredActions:[
        "Run catalog and release-reconciliation lookups keyed by the validated ISRC.",
        "Verify title, artist, label, album and release-date variants against returned provider records.",
        "Keep rights and clearance checks separate from identity and market-performance findings.",
      ],
    };
  }
  return {
    status:"pending_verification",route:"NON_ISRC_FALLBACK",isrc:null,source:null,conflicts:[],nonIsrcEvidence,
    requiredActions:[
      "Record the ISRC as unavailable or pending verification; do not invent a catalog match.",
      "Use only the available measured audio, embedded tags, supplied identity and campaign context for provisional A&R guidance.",
      "Confirm or register the ISRC, reconcile release metadata, and complete rights and clearance checks before wide distribution or external pitching.",
    ],
  };
}

export function buildMarketPlacementPlan(input: MarketPlacementInput): MarketPlacementPlan {
  const allPlaylistMatches = playlistTargets(input.playlistDiscovery);
  const presence = allPlaylistMatches.filter((item) => item.matchStatus === "isrc_present").map((item, index) => ({ ...item, rank: index + 1 }));
  const targets = allPlaylistMatches.filter((item) => item.matchStatus !== "isrc_present").map((item, index) => ({ ...item, rank: index + 1 }));
  const territories = territoryPriorities(input.evidence);
  const hooks = shortFormHooks(input.sonicDna, input.executionMode);
  const fit = positioning(input.sonicDna, input.evidence);
  const isrcStrategy = resolveIsrcStrategyRoute(input.evidence, input.sonicDna);
  return {
    version: "market-placement-v1",
    isrcStrategy,
    playlistPresence: presence,
    playlistTargets: targets,
    acousticSimilarity: { status: "unavailable", reason: "The configured playlist endpoints do not expose candidate-track BPM, key, energy and acoustic feature vectors. Playlist targeting therefore uses exact ISRC presence plus provider-returned genre/mood metadata; no track-to-playlist acoustic similarity score is asserted." },
    territoryPriorities: territories,
    shortFormHooks: hooks,
    positioning: fit,
    rollout: rollout(targets.length, hooks.status === "available", territories.status),
    globalLimitations: [
      "This plan reconciles supplied track evidence and provider-returned catalogue metadata; it does not create audience, sales, revenue or campaign telemetry.",
      "Playlist similarity, provisional mood/energy and acoustic peak scores are targeting aids or hypotheses, not calibrated success predictions.",
      "Territory rankings require verified provider-attributed audience data; artist location, genre popularity and ISRC matches are not substitutes.",
      "MusicBrainz-derived data remains evaluation-only for commercial distribution until commercial-use and retention permissions are confirmed.",
    ],
  };
}
