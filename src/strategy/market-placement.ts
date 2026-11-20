export type StrategyStatus = "available" | "unavailable" | "review_required" | "blocked";

export interface MarketPlacementInput {
  executionMode: "master" | "combined" | "dsp_link";
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  playlistDiscovery?: Record<string, unknown> | null;
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

export interface MarketPlacementPlan {
  version: "market-placement-v1";
  playlistTargets: PlaylistTarget[];
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
    const priorityScore = Math.min(100, (containsIsrc ? 100 : 0) + (genreMatches.length ? 55 : 0) + Math.min(20, genreMatches.length * 5) + Math.min(10, moodMatches.length * 5));
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
    status: "unavailable", method: "onset_envelope_plus_windowed_rms_v1", segments: [],
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
    status: "available", method: "onset_envelope_plus_windowed_rms_v1", segments,
    limitations: [
      "Priority scores are relative signal-ranking aids, not probabilities, retention predictions or proof of a memorable hook.",
      "The downsampled onset envelope and sparse windowed RMS summaries locate candidate excerpts; human listening must confirm musical context, lyrics, clean edit boundaries and suitability.",
      "Candidates are edit suggestions, not confirmed musical hooks; human listening and rights review are required before publication.",
    ],
  };
}

function positioning(sonicDna: Record<string, unknown> | null, evidence: Record<string, unknown>): MarketPlacementPlan["positioning"] {
  const bpm = finite(sonicDna?.bpm);
  const confidence = finite(sonicDna?.tempoConfidence);
  const rhythm = record(sonicDna?.rhythmFeatures);
  const energy = record(record(sonicDna?.acousticFeatureProfile).predictions);
  const energyPrediction = record(energy.energy);
  const masterProvenance = clean(sonicDna?.provenance) === "uploaded_audio_master";
  const reliableTempo = masterProvenance && bpm !== null && bpm >= 40 && bpm <= 240 && confidence !== null && confidence >= 0.5;
  const beatGrid = clean(rhythm.beatGridStatus) === "tentative";
  const energyAvailable = energyPrediction.status === "provisional" && ["low", "moderate", "high"].includes(clean(energyPrediction.label));
  const dj: PositioningRecommendation = reliableTempo && beatGrid
    ? { status: "review_required", reason: "The uploaded master has confidence-qualified tempo and a tentative beat grid; audition and DJ transition testing are still required.", basis: ["Measured tempo: " + bpm + " BPM", "Tentative beat-grid evidence is present"], limitations: ["Tempo and beat-grid evidence do not establish DJ demand, mix compatibility or venue support."] }
    : { status: "blocked", reason: "DJ positioning requires a confidence-qualified master tempo and tentative beat-grid evidence.", basis: [], limitations: ["No DJ suitability claim is made from metadata-only or low-confidence tempo candidates."] };
  const club: PositioningRecommendation = reliableTempo && beatGrid && energyAvailable
    ? { status: "review_required", reason: "Tempo, tentative beat-grid and provisional energy evidence justify a human club-play test, not a venue or audience claim.", basis: ["Measured tempo: " + bpm + " BPM", "Provisional audio energy: " + clean(energyPrediction.label), "Tentative beat-grid evidence is present"], limitations: ["Provisional energy is heuristic, not a calibrated perceptual score; these signals are not evidence of venue demand or dancefloor response."] }
    : { status: "blocked", reason: "Club positioning requires confidence-qualified tempo, tentative beat-grid evidence and a provisional audio-energy estimate.", basis: [], limitations: ["No club-fit conclusion is inferred from genre labels or catalogue popularity alone."] };
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

export function buildMarketPlacementPlan(input: MarketPlacementInput): MarketPlacementPlan {
  const targets = playlistTargets(input.playlistDiscovery);
  const territories = territoryPriorities(input.evidence);
  const hooks = shortFormHooks(input.sonicDna, input.executionMode);
  const fit = positioning(input.sonicDna, input.evidence);
  return {
    version: "market-placement-v1",
    playlistTargets: targets,
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
