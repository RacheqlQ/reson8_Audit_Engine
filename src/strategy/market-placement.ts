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

export interface IsrcCoverageSummary {
  status: "RESOLVED" | "ISRC_UNRESOLVED";
  isrc: string | null;
  resolvedVia: "musicbrainz" | "dsp_metadata" | "id3_metadata" | "unresolved";
  linkedReleasesCount: number;
  matchedPlatforms: string[];
  catalogPresenceTier: "MULTI_PLATFORM" | "SINGLE_PLATFORM" | "MUSICBRAINZ_ONLY" | "NO_CATALOG_MATCH";
  boundaryNote: string;
}
export interface CommercialStrategy {
  marketVerdict: "PROPOSED";
  releaseDateVerdict: "DETERMINED" | "UNDETERMINED";
  releaseLifecycle: "POST_RELEASE" | "PRE_RELEASE" | "UNKNOWN";
  primaryLane: { label: string; rationale: string; verdict: "PROPOSED" };
  adjacentLanes: Array<{ label: string; rationale: string; verdict: "PROPOSED" }>;
  audienceContexts: string[];
  shortFormAngles: string[];
  playlistPitchHooks: string[];
  partnerFitCriteria: string[];
  industryPractice: string[];
  syncFit: { status: "REVIEW_REQUIRED" | "BLOCKED"; rationale: string };
  readinessActions: string[];
  kpis: Array<{ metric: string; target: string; verification: string; status: "actionable" | "awaiting_telemetry" | "verify_source" }>;
  limitations: string[];
}
export interface MarketPlacementPlan {
  version: "market-placement-v1";
  isrcCoverage: IsrcCoverageSummary;
  commercialStrategy: CommercialStrategy;
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

const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

function playlistTargets(value: unknown): PlaylistTarget[] {
  const discovery = record(value);
  const candidates = Array.isArray(discovery.candidates) ? discovery.candidates : [];
  const targets = candidates.flatMap((raw) => {
    const item = record(raw);
    const provider = clean(item.provider);
    const name = clean(item.name);
    const url = clean(item.url);
    if (!provider || !name || !/^https:\/\//i.test(url)) return [];
    const matchBasis = Array.isArray(item.matchBasis)
      ? unique(item.matchBasis.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()))
      : [];
    const containsIsrc = item.containsIsrc === true;
    const genreMatches = Array.isArray(item.genreMatches) ? item.genreMatches.filter((entry) => typeof entry === "string") : [];
    const moodMatches = Array.isArray(item.moodMatches) ? item.moodMatches.filter((entry) => typeof entry === "string") : [];
    const priorityScore = Math.min(85, (genreMatches.length ? 55 : 0) + Math.min(20, genreMatches.length * 5) + Math.min(10, moodMatches.length * 5));
    return [{
      rank: 0,
      provider,
      name,
      url,
      retrievedAt: clean(item.retrievedAt) || null,
      matchStatus: containsIsrc ? "isrc_present" as const : item.containsIsrc === false ? "isrc_not_found" as const : "membership_unverified" as const,
      priorityScore,
      matchBasis,
      limitations: [
        "A catalogue match is a targeting lead, not curator interest, editorial acceptance, playlist placement or audience demand.",
        ...(item.containsIsrc === null || item.containsIsrc === undefined ? ["Playlist membership was not verified for this provider result."] : []),
      ],
    }];
  });
  targets.sort((a, b) => b.priorityScore - a.priorityScore || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return targets.slice(0, 8).map((item, index) => ({ ...item, rank: index + 1 }));
}

function isIsoCountryCode(value: string): boolean {
  if (!/^[A-Z]{2}$/.test(value)) return false;
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(value);
  return Boolean(name && name !== value && name !== "Unknown Region");
}

function territoryPriorities(evidence: Record<string, unknown>): TerritoryPriorities {
  const telemetry = record(evidence.audienceTelemetry);
  const provider = clean(telemetry.provider);
  const metric = clean(telemetry.metric);
  const reportingPeriod = clean(telemetry.reportingPeriod);
  const retrievedAt = clean(telemetry.retrievedAt);
  const rawTerritories = Array.isArray(telemetry.territories) ? telemetry.territories : [];
  const valid = telemetry.verified === true
    && provider.length > 0
    && metric.length > 0
    && reportingPeriod.length > 0
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(retrievedAt)
    && Number.isFinite(Date.parse(retrievedAt))
    && rawTerritories.length > 0
    && rawTerritories.every((raw) => {
      const item = record(raw);
      return isIsoCountryCode(clean(item.countryCode))
        && finite(item.value) !== null
        && (finite(item.value) as number) >= 0;
    });
  if (!valid) {
    return {
      status: "unavailable",
      reason: "No verified territory-level audience telemetry with a named provider, metric, reporting period and retrieval timestamp was supplied. Territory priorities are withheld rather than inferred from genre or artist location.",
      provider: null, metric: null, reportingPeriod: null, retrievedAt: null, territories: [],
    };
  }
  const territories = rawTerritories.map((raw) => ({
    countryCode: clean(record(raw).countryCode),
    value: finite(record(raw).value) as number,
  })).sort((a, b) => b.value - a.value || a.countryCode.localeCompare(b.countryCode));
  return { status: "available", reason: "Ranked by the supplied verified provider metric; values are not combined across providers or reporting periods.", provider, metric, reportingPeriod, retrievedAt, territories };
}

function shortFormHooks(sonicDna: Record<string, unknown> | null, executionMode: MarketPlacementInput["executionMode"]): ShortFormHooks {
  const unavailable = (reason: string): ShortFormHooks => ({
    status: "unavailable", method: "onset and signal-level review", segments: [],
    limitations: [reason, "Candidates are edit suggestions, not confirmed musical hooks; human listening and rights review are required before publication."],
  });
  if (executionMode === "dsp_link" || clean(sonicDna?.provenance) !== "uploaded_audio_master") {
    return unavailable("Timestamped excerpts require an uploaded master; catalogue metadata cannot establish audio peak locations.");
  }
  const duration = finite(sonicDna?.durationSeconds);
  const rhythm = record(sonicDna?.rhythmFeatures);
  const envelope = Array.isArray(rhythm.onsetEnvelope) ? rhythm.onsetEnvelope.map(finite) : [];
  if (duration === null || duration < 8 || envelope.length < 4 || envelope.some((value) => value === null || value < 0)) {
    return unavailable("A usable master duration and bounded onset envelope were not available for excerpt selection.");
  }
  const peaks = envelope as number[];
  if (Math.max(...peaks) <= 0) return unavailable("The onset envelope contains no positive transient peaks to prioritize.");
  const profile = record(sonicDna?.acousticFeatureProfile);
  const summaries = Array.isArray(profile.windowSummaries) ? profile.windowSummaries.map(record) : [];
  const rmsValues = summaries.map((item) => finite(item.rmsDbfs)).filter((value): value is number => value !== null);
  if (!summaries.length || !rmsValues.length) return unavailable("Windowed RMS summaries were unavailable, so onset peaks cannot be paired with energy context.");
  const minRms = rmsValues.length ? Math.min(...rmsValues) : 0;
  const maxRms = rmsValues.length ? Math.max(...rmsValues) : 0;
  const energyAt = (time: number): number => {
    if (!summaries.length || !rmsValues.length) return 0.5;
    let nearest: Record<string, unknown> | null = null, distance = Number.POSITIVE_INFINITY;
    for (const item of summaries) {
      const start = finite(item.startSeconds);
      if (start === null) continue;
      const delta = Math.abs(start - time);
      if (delta < distance) { distance = delta; nearest = item; }
    }
    const rms = nearest ? finite(nearest.rmsDbfs) : null;
    return rms === null || maxRms === minRms ? 0.5 : Math.max(0, Math.min(1, (rms - minRms) / (maxRms - minRms)));
  };
  const localPeaks = peaks.map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value > 0 && value >= (peaks[index - 1] ?? -1) && value >= (peaks[index + 1] ?? -1))
    .map(({ value, index }) => {
      const peakTime = (index + 0.5) / peaks.length * duration;
      const energy = energyAt(peakTime);
      return { peakTime, score: Math.round(Math.max(0, Math.min(100, (value * 0.7 + energy * 0.3) * 100))), energy, onset: value };
    })
    .sort((a, b) => b.score - a.score || a.peakTime - b.peakTime);
  const clipLength = Math.min(12, duration);
  const segments: ShortFormHooks["segments"] = [];
  for (const peak of localPeaks) {
    if (segments.some((segment) => Math.abs((segment.startSeconds + segment.endSeconds) / 2 - peak.peakTime) < clipLength)) continue;
    const startSeconds = Math.max(0, Math.min(duration - clipLength, peak.peakTime - clipLength / 2));
    const endSeconds = startSeconds + clipLength;
    segments.push({
      startSeconds: Number(startSeconds.toFixed(2)),
      endSeconds: Number(endSeconds.toFixed(2)),
      score: peak.score,
      scoreType: "relative_signal_peak_priority",
      signals: unique([...(peak.onset > 0 ? ["onset/transient peak"] : []), ...(peak.energy > 0.5 ? ["higher relative windowed RMS"] : ["windowed RMS context"]) ]),
    });
    if (segments.length === 3) break;
  }
  if (!segments.length) return unavailable("No distinct local onset peaks were found in the uploaded master.");
  return {
    status: "available", method: "Onset and relative signal-level review", segments,
    limitations: [
      "Priority scores are relative signal-ranking aids, not probabilities, retention predictions or proof of a memorable hook.",
      "The downsampled onset envelope and sparse windowed RMS summaries locate candidate excerpts; human listening must confirm musical context, lyrics, clean edit boundaries and suitability.",
      "Candidates are edit suggestions, not confirmed musical hooks; human listening and rights review are required before publication.",
    ],
  };
}

function positioning(sonicDna: Record<string, unknown> | null, evidence: Record<string, unknown>): MarketPlacementPlan["positioning"] {
  const bpm = finite(sonicDna?.bpm);
  const alternateTempo = finite(sonicDna?.alternateTempo);
  const confidence = finite(sonicDna?.tempoConfidence);
  const key = clean(sonicDna?.key);
  const mode = clean(sonicDna?.mode);
  const keyConfidence = finite(sonicDna?.keyConfidence);
  const keyAgreement = finite(sonicDna?.keySegmentAgreement);
  const rhythm = record(sonicDna?.rhythmFeatures);
  const energy = record(record(sonicDna?.acousticFeatureProfile).predictions);
  const energyPrediction = record(energy.energy);
  const masterProvenance = clean(sonicDna?.provenance) === "uploaded_audio_master";
  const reliableTempo = masterProvenance && bpm !== null && bpm >= 40 && bpm <= 240 && confidence !== null && confidence >= 0.5;
  const beatGrid = clean(rhythm.beatGridStatus) === "tentative";
  const energyAvailable = energyPrediction.status === "provisional" && ["low", "moderate", "high"].includes(clean(energyPrediction.label));
  const reliableKey = masterProvenance && Boolean(key) && ["major", "minor"].includes(mode) && keyConfidence !== null && keyConfidence >= 0.8 && keyAgreement !== null && keyAgreement >= 0.8;
  const djBasis = [ "Measured tempo: " + bpm + " BPM", "Tentative beat-grid evidence is present" ];
  if (alternateTempo !== null && bpm !== null && alternateTempo !== bpm) djBasis.push("Alternate metrical interpretation: " + alternateTempo + " BPM; this is an alternate half/double-time reading, not a second independent tempo.");
  if (reliableKey) djBasis.push("Harmonic estimate: " + key + " " + mode + " (key consistency across the analyzed sections).");
  const dj: PositioningRecommendation = reliableTempo && beatGrid
    ? { status: "review_required", reason: "The uploaded master has a reportable tempo and a tentative beat guide; audition and DJ transition testing are still required.", basis: djBasis, limitations: ["Tempo and beat-grid evidence do not establish DJ demand, mix compatibility or venue support.", ...(reliableKey ? ["The key estimate is a harmonic-mixing cue only; human confirmation is still required."] : [])] }
    : { status: "blocked", reason: "DJ positioning requires a reliable tempo reading and a tentative beat guide.", basis: [], limitations: ["No DJ suitability claim is made from metadata-only or low-confidence tempo candidates."] };
  const club: PositioningRecommendation = reliableTempo && beatGrid && energyAvailable
    ? { status: "review_required", reason: "Tempo, tentative beat-grid and provisional energy evidence justify a human club-play test, not a venue or audience claim.", basis: ["Measured tempo: " + bpm + " BPM", "Provisional audio energy: " + clean(energyPrediction.label), "Tentative beat-grid evidence is present"], limitations: ["Provisional energy is heuristic, not a calibrated perceptual score; these signals are not evidence of venue demand or dancefloor response."] }
    : { status: "blocked", reason: "Club positioning requires a reportable tempo, a tentative beat guide and a provisional energy estimate.", basis: [], limitations: ["No club-fit conclusion is inferred from genre labels or catalogue popularity alone."] };
  const rights = clean(evidence.rightsStatus).toLowerCase();
  const rightsCleared = ["cleared", "rights_cleared"].includes(rights);
  const approved = evidence.masterApproved === true;
  const sync: PositioningRecommendation = rightsCleared && approved
    ? { status: "review_required", reason: "Rights and master-approval fields are marked complete; a human sync brief, edit/version review and chain-of-title check are still required.", basis: ["Rights status: " + rights, "Master approval: verified"], limitations: ["This is not a sync match or clearance; no brief, usage, territory, term, media or fee has been verified."] }
    : { status: "blocked", reason: "Sync outreach is blocked until rights clearance and approved master are verified.", basis: [], limitations: ["No sync suitability or clearance is inferred from audio features, ISRC or catalogue presence."] };
  return { dj, club, sync };
}

function rollout(targetCount: number, hooksAvailable: boolean, territoryStatus: TerritoryPriorities["status"]): MarketPlacementPlan["rollout"] {
  return [
    {
      phase: "pre_release",
      actions: [
        "Reconfirm reconciled artist, title, ISRC, ownership, split and sample-clearance evidence before any third-party pitching.",
        targetCount ? "Review the provider-returned playlist shortlist, eligibility rules and submission routes; treat each result as a lead, not a placement." : "Do not invent playlist targets; complete catalogue discovery only after a valid recording identity and provider access are available.",
        hooksAvailable ? "Have a human listener audition the timestamped excerpt candidates, select clean edit boundaries and approve captions and visual assets." : "Select any short-form excerpt through human listening; no master-derived timestamp candidate is currently available.",
      ],
      gates: ["Rights and identity verified", "Final master and artwork approved", "No unsupported audience or placement claims"],
    },
    {
      phase: "release_window",
      actions: [
        "Coordinate confirmed DSP delivery with artist-owned social, video, press and direct-to-fan channels using trackable campaign links.",
        "Test DJ/club positioning only after an A&R or DJ listener reviews transitions, intro/outro structure and playback context.",
        "Use sync outreach only against a defined brief after rights, master approval, versioning and chain-of-title checks.",
      ],
      gates: ["DSP delivery confirmed by distributor or platform", "Campaign assets approved", "Partner outreach recorded with source and response status"],
    },
    {
      phase: "post_release",
      actions: [
        territoryStatus === "available" ? "Review the supplied provider-attributed territory metrics within their stated reporting period; do not combine incomparable measures." : "Collect provider-attributed territory, listener and engagement telemetry with a named reporting period before ranking markets.",
        "Compare saves, completion, attributable visits and playlist outcomes only where platform-native reports or campaign analytics supply the measurements.",
        "Record actual outreach, responses and campaign outcomes; update the next cycle from observed results rather than assumed conversion.",
      ],
      gates: ["Reporting window and provider defined", "Metrics retained with retrieval timestamps", "No inferred revenue, audience demand or campaign success"],
    },
  ];
}


function metadataRecords(evidence: Record<string, unknown>): Record<string, unknown>[] {
  return (Array.isArray(evidence.metadataSources) ? evidence.metadataSources : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}
function isrcCoverage(evidence: Record<string, unknown>): IsrcCoverageSummary {
  const records = metadataRecords(evidence);
  const claims = [clean(evidence.isrc), clean(record(evidence.identity).isrc), ...records.map(item => clean(item.isrc))]
    .filter(value => /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(value.replace(/[\s-]/g,"").toUpperCase()))
    .map(value => value.replace(/[\s-]/g,"").toUpperCase());
  const isrc = claims[0] ?? null;
  const matched = isrc ? records.filter(item => clean(item.isrc).replace(/[\s-]/g,"").toUpperCase() === isrc) : [];
  const musicBrainz = matched.find(item => clean(item.platform) === "musicbrainz");
  const raw = record(musicBrainz?.raw);
  const recordings = Array.isArray(raw.recordings) ? raw.recordings : [];
  const linkedPlatforms = recordings.flatMap(item => {
    const links = Array.isArray(record(item).externalUrls) ? record(item).externalUrls as unknown[] : [];
    return links.flatMap(link => {
      const resource = clean(record(link).resource).toLowerCase();
      if (resource.includes("spotify.com")) return ["spotify"];
      if (resource.includes("music.apple.com") || resource.includes("itunes.apple.com")) return ["apple_music"];
      if (resource.includes("tidal.com")) return ["tidal"];
      if (resource.includes("deezer.com")) return ["deezer"];
      if (resource.includes("youtube.com") || resource.includes("youtu.be")) return ["youtube_music"];
      if (resource.includes("audiomack.com")) return ["audiomack"];
      return [];
    });
  });
  const platforms = unique([...matched.map(item => clean(item.platform)), ...linkedPlatforms].filter(Boolean));
  const releases = new Set<string>();
  for (const item of recordings) {
    const linked = Array.isArray(record(item).releases) ? record(item).releases as unknown[] : [];
    for (const release of linked) {
      const id = clean(record(release).releaseId) || clean(record(release).id);
      if (id) releases.add(id);
    }
  }
  const resolvedVia = !isrc ? "unresolved"
    : musicBrainz ? "musicbrainz"
    : matched.some(item => ["spotify","apple_music","youtube_music","deezer","tidal","audiomack"].includes(clean(item.platform))) ? "dsp_metadata"
    : records.some(item => clean(item.platform) === "id3" && clean(item.isrc) === isrc) ? "id3_metadata"
    : "unresolved";
  const status = isrc && matched.length > 0 ? "RESOLVED" : "ISRC_UNRESOLVED";
  const tier = platforms.length > 1 ? "MULTI_PLATFORM"
    : platforms.length === 1 && platforms[0] === "musicbrainz" ? "MUSICBRAINZ_ONLY"
    : platforms.length === 1 ? "SINGLE_PLATFORM" : "NO_CATALOG_MATCH";
  return {
    status, isrc, resolvedVia: status === "RESOLVED" ? resolvedVia : "unresolved",
    linkedReleasesCount: releases.size, matchedPlatforms: platforms, catalogPresenceTier: tier,
    boundaryNote: "Catalogue presence indicates availability/reconciliation only—not streams, listeners, commercial demand, playlist reach or revenue.",
  };
}
function commercialStrategy(
  evidence: Record<string, unknown>, sonicDna: Record<string, unknown> | null,
  coverage: IsrcCoverageSummary, hooks: ShortFormHooks, fit: MarketPlacementPlan["positioning"],
): CommercialStrategy {
  const generatedAt = clean(evidence.generatedAt) || new Date().toISOString();
  const auditDate = Number.isFinite(Date.parse(generatedAt)) ? Date.parse(generatedAt) : Date.now();
  const releaseDateConflict = [...arrayValue(record(evidence.reconciliation).conflicts), ...arrayValue(record(evidence.reconciliation).releaseContextDifferences)].some(item => clean(record(item).field) === "releaseDate");
  const releaseDate = releaseDateConflict ? "" : clean(evidence.releaseDate) || clean(record(evidence.identity).releaseDate);
  const releaseTime = releaseDate && Number.isFinite(Date.parse(releaseDate)) ? Date.parse(releaseDate) : null;
  const releaseDateVerdict = releaseTime === null ? "UNDETERMINED" : "DETERMINED";
  const releaseLifecycle = releaseTime === null ? "UNKNOWN" : releaseTime <= auditDate ? "POST_RELEASE" : "PRE_RELEASE";
  const genre = record(evidence.genreClassification);
  const primary = clean(genre.primaryGenre) || clean(evidence.genre) || "Unclassified sonic lane";
  const adjacent = Array.isArray(genre.adjacentLanes) ? genre.adjacentLanes.filter((v): v is string => typeof v === "string" && v.trim()).slice(0,3) : [];
  const tempo = finite(sonicDna?.bpm), key = clean(sonicDna?.key), mode = clean(sonicDna?.mode);
  const profile = record(sonicDna?.acousticFeatureProfile), predictions = record(profile.predictions);
  const mood = record(predictions.mood), energy = record(predictions.energy);
  const moodTags = Array.isArray(mood.labels) ? mood.labels.filter((v): v is string => typeof v === "string").slice(0,3) : [];
  const vocal = record(sonicDna?.vocalFeatures);
  const cadence = clean(vocal.cadence) || clean(vocal.cadenceCue);
  const loudness = finite(sonicDna?.loudnessLufs), peak = finite(sonicDna?.truePeakDbfs), lra = finite(sonicDna?.loudnessRangeLu);
  const reconciliation = record(evidence.reconciliation);
  const conflicts = Array.isArray(reconciliation.releaseContextDifferences) ? reconciliation.releaseContextDifferences : [];
  const readinessActions: string[] = [];
  if (!coverage.isrc) readinessActions.push("Resolve and register the recording ISRC; verify it against the final master and distributor delivery.");
  if (!clean(evidence.upc) && !recordsHaveField(evidence, "upc")) readinessActions.push("Confirm the release UPC/EAN with the distributor and align it across DSP delivery records.");
  if (!clean(evidence.label) && !recordsHaveField(evidence, "label")) readinessActions.push("Confirm the label or self-releasing imprint and ensure label metadata is consistent across delivery records.");
  if (conflicts.length) readinessActions.push("Resolve release-edition metadata differences ("+conflicts.map(item => clean(record(item).field)).filter(Boolean).join(", ")+") before royalty statements and partner pitching.");
  if (!clean(evidence.rightsStatus) || !["cleared","rights_cleared"].includes(clean(evidence.rightsStatus).toLowerCase())) readinessActions.push("Document master ownership, writer/publisher splits, sample/interpolation clearance and authorized contact before commercial outreach.");
  if (!readinessActions.length) readinessActions.push("Retain the source-backed ISRC, UPC, label, release-date and rights evidence with the distributor delivery receipt.");
  const daypart = /warm|laid.?back|mellow|intimate|reflective/i.test(moodTags.join(" ")) ? "late-evening, reflective listening"
    : /energetic|driving|upbeat|bright|aggressive/i.test(moodTags.join(" ")) ? "commute, movement or high-energy short-form contexts"
    : "test daytime discovery and focused listening contexts";
  const contexts = [
    ...(moodTags.length ? ["Audience-context hypothesis: test "+daypart+" around provisional cues "+moodTags.join(", ")+"; these are editorial contexts, not measured audience segments."] : ["Build mood/daypart context from a human listening pass; no calibrated mood model is configured."]),
    ...(tempo !== null ? ["Use "+tempo+" BPM as an editorial tempo descriptor, not a demand or danceability prediction."] : []),
    ...(key ? ["Use "+key+(mode ? " "+mode : "")+" only as a provisional harmonic descriptor for pitch notes."] : []),
  ];
  const shortFormAngles = hooks.status === "available"
    ? hooks.segments.map((segment,index)=>"Audition excerpt "+(index+1)+" ("+Math.round(segment.startSeconds)+"–"+Math.round(segment.endSeconds)+"s); test a lyric/motif, performance or visual narrative only after human selection.")
    : ["Select a human-approved 8–15 second motif or performance moment; no signal-derived edit candidate is available."];
  const pitchHooks = [
    "Pitch the reconciled primary lane ("+primary+") with verified recording identity and a concise sonic description.",
    ...(moodTags.length ? ["Frame mood context as a provisional listening cue ("+moodTags.join(", ")+"), not a listener profile."] : []),
    ...(tempo !== null ? ["Include the measured "+tempo+" BPM and any confirmed edit/version details in curator notes."] : []),
  ];
  const metadataSources = metadataRecords(evidence);
  const fields = ["title","artist","isrc","upc","label","releaseDate","album"];
  const sourceValues = fields.map(field => new Set(metadataSources.map(item=>clean(item[field])).filter(Boolean)));
  const comparableFields = sourceValues.filter(values=>values.size>1);
  const parity = comparableFields.length ? comparableFields.filter(values=>values.size===1).length / comparableFields.length * 100 : 0;
  const kpis: CommercialStrategy["kpis"] = [
    { metric:"Metadata parity across title/artist/ISRC/UPC/label/release date/album", target:"100% of populated identifiers and release fields agree or have documented edition-level differences", verification:comparableFields.length ? "Compare distributor delivery sheet with each returned DSP/catalogue record; "+Math.round(parity)+"% of "+comparableFields.length+" fields with competing source claims agree.":"Insufficient cross-source field overlap to calculate parity; reconcile the delivery sheet against at least two independent catalogue records.", status:"verify_source" },
    { metric:"True-peak delivery headroom", target:"At or below -1.0 dBTP unless the delivery specification states otherwise", verification:peak===null?"Measure final approved master true peak; no value supplied.":"Uploaded-master true peak "+peak.toFixed(1)+" dBFS; compare against distributor/partner delivery specification.", status:peak===null?"actionable":"verify_source" },
    { metric:"Campaign asset outputs", target:"3 approved short-form edits, 1 clean instrumental if rights/production permit, 1 artwork/metadata pack", verification:"Count completed and approved deliverables in the campaign log; no output count is presumed.", status:"actionable" },
    { metric:"Partner outreach", target:"10 individually qualified curator/partner pitches with source, date and response logged", verification:"Maintain a dated outreach register; target count is an action plan, not existing reach.", status:"actionable" },
    { metric:"DSP performance telemetry", target:"Log streams, unique listeners, saves, playlist adds and territory data by provider and reporting period", verification:"Await platform-native analytics or distributor statements; no values are inferred from catalogue presence.", status:"awaiting_telemetry" },
  ];
  if (loudness !== null || lra !== null) kpis.push({metric:"Master loudness / dynamics reference",target:"Compare against the intended platform, format and creative brief; no universal loudness target asserted",verification:"Uploaded master: "+(loudness===null?"LUFS unavailable":loudness.toFixed(1)+" LUFS")+(lra===null?"":"; LRA "+lra.toFixed(1)+" LU"),status:"verify_source"});
  const syncBlocked = fit.sync.status === "blocked";
  return {
    marketVerdict:"PROPOSED",releaseDateVerdict,releaseLifecycle,
    primaryLane:{label:primary,rationale:"Proposed from reconciled genre metadata"+(tempo!==null?", measured "+tempo+" BPM":"")+(moodTags.length?", provisional mood cues "+moodTags.join(", "):"")+(cadence?", heuristic cadence cue "+cadence:"")+". Validate with human listening and response data.",verdict:"PROPOSED"},
    adjacentLanes:adjacent.map(label=>({label,rationale:"Adjacent discovery test only; validate against the full recording, release identity and curator feedback.",verdict:"PROPOSED" as const})),
    audienceContexts:contexts,shortFormAngles,playlistPitchHooks:pitchHooks,
    partnerFitCriteria:[
      "Partner roster and campaign remit align with the proposed primary/adjacent lanes and the actual release stage.",
      "Partner can document deliverables, reporting access, fees/commission, territory, term and ownership of campaign assets before engagement.",
      "Any playlist, creator, sync or distribution claim is supported by a dated source record and written terms; no placement or reach guarantee is accepted.",
    ],
    industryPractice:[
      "Prioritize identifier and rights hygiene before royalty-bearing distribution, playlist pitching or licensing outreach.",
      "Use a small, individually qualified pitch batch with approved assets and logged responses; expand only after evidence of relevant partner engagement.",
      "Separate catalogue availability from performance: record streams, saves, listeners and territory metrics only from authenticated DSP/distributor reporting.",
    ],
    syncFit:{status:syncBlocked?"BLOCKED":"REVIEW_REQUIRED",rationale:fit.sync.reason+" Audio and catalogue descriptors do not constitute a sync match or rights clearance."},
    readinessActions,
    kpis,
    limitations:["No stream, listener, chart, revenue, conversion or campaign-success values are generated from ISRC or catalogue matches.","Sonic mood, cadence and energy cues are provisional signal descriptors; they are not demographic or audience measurements.","Release-date lifecycle is determined only when a parseable source-backed release date exists; pre/post framing is relative to the recorded audit timestamp.","MusicBrainz catalogue details are internal evaluation evidence only until commercial-use and retention permissions are confirmed."],
  };
}
function recordsHaveField(evidence: Record<string, unknown>, field: string): boolean {
  return metadataRecords(evidence).some(item => Boolean(clean(item[field])));
}

export function buildPlaylistMoodContext(
  providerMoodTags: readonly string[],
  sonicDna: { acousticFeatureProfile?: unknown } | null,
): { moodTags: string[]; moodSource: string | null } {
  const providerTags = unique([...providerMoodTags]);
  const profile = record(sonicDna?.acousticFeatureProfile);
  const predictions = record(profile.predictions);
  const mood = record(predictions.mood);
  const audioTags = mood.status === "provisional" && Array.isArray(mood.labels)
    ? mood.labels.filter((label): label is string => typeof label === "string").map((label) => label.trim()).filter(Boolean)
    : [];
  const sources = [
    ...(providerTags.length ? ["DSP catalogue sonic profile"] : []),
    ...(audioTags.length ? ["uploaded-master provisional audio_feature_heuristics_v1"] : []),
  ];
  return { moodTags: unique([...providerTags, ...audioTags]), moodSource: sources.length ? sources.join("; ") : null };
}

export function buildMarketPlacementPlan(input: MarketPlacementInput): MarketPlacementPlan {
  const allPlaylistMatches = playlistTargets(input.playlistDiscovery);
  const presence = allPlaylistMatches.filter((item) => item.matchStatus === "isrc_present").map((item, index) => ({ ...item, rank: index + 1 }));
  const targets = allPlaylistMatches.filter((item) => item.matchStatus !== "isrc_present").map((item, index) => ({ ...item, rank: index + 1 }));
  const territories = territoryPriorities(input.evidence);
  const hooks = shortFormHooks(input.sonicDna, input.executionMode);
  const fit = positioning(input.sonicDna, input.evidence);
  const coverage = isrcCoverage(input.evidence);
  const strategy = commercialStrategy(input.evidence, input.sonicDna, coverage, hooks, fit);
  return {
    version: "market-placement-v1",
    isrcCoverage: coverage,
    commercialStrategy: strategy,
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
