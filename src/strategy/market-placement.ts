export type StrategyEvidenceClass = "OBSERVED" | "RECOGNIZED" | "RECONCILED" | "INFERRED" | "INDUSTRY PRACTICE";

export interface MarketPlacementInput {
  auditId: string;
  generatedAt: string;
  executionMode: "master" | "combined" | "dsp_link";
  identity: { artist: string | null; title: string | null; isrc: string | null };
  genreClassification?: {
    primaryGenre: string | null;
    adjacentLanes: readonly string[];
    confidence: number;
    abstained: boolean;
    genres: readonly { id: string; label: string; confidence: number; sources: readonly string[] }[];
    regionTags: readonly string[];
    sceneTags: readonly string[];
    evidence: { providerCount: number };
  } | null;
  playlistDiscovery?: {
    status: "available" | "partial" | "no_matches" | "not_configured" | "unavailable";
    candidates: readonly {
      provider: "spotify" | "apple_music";
      id: string;
      name: string;
      url: string;
      curatorName: string | null;
      playlistType: string | null;
      trackCount: number | null;
      genreMatches: readonly string[];
      moodMatches: readonly string[];
      matchBasis: readonly string[];
      containsIsrc: boolean | null;
      retrievedAt: string;
    }[];
    outcomes: readonly { provider: string; status: string; reason: string }[];
  } | null;
  sonicDna?: {
    provenance?: string;
    durationSeconds?: number;
    bpm?: number | null;
    tempoConfidence?: number | null;
    key?: string | null;
    mode?: "major" | "minor" | null;
    keyConfidence?: number | null;
    moodTags?: readonly string[];
    acousticFeatureProfile?: {
      status: "measured" | "insufficient_evidence";
      predictions?: {
        mood?: { status: "provisional" | "unavailable"; labels?: readonly string[] };
        energy?: { status: "provisional" | "unavailable"; label?: string | null };
      };
      windowSummaries?: readonly {
        startSeconds: number;
        endSeconds: number;
        rmsDbfs: number;
        spectralCentroidHz: number;
        spectralFlatness: number;
        spectralFlux: number;
      }[];
    };
    rhythmFeatures?: {
      beatGridStatus?: "tentative" | "not_determined";
      beatTimesSeconds?: readonly number[];
      onsetEnvelope?: readonly number[];
    };
  } | null;
  territoryTelemetry?: readonly {
    provider: string;
    territory: string;
    metric: "listeners" | "streams" | "saves" | "playlist_adds";
    value: number;
    unit: string;
    retrievedAt: string;
    sourceUrl: string;
    evidenceClass: "RECOGNIZED" | "RECONCILED";
  }[];
}

export interface MarketPlacementAction {
  action: string;
  evidenceClass: "INFERRED" | "INDUSTRY PRACTICE";
  evidenceRefs: string[];
  limitation: string;
}

export interface MarketPlacementResult {
  schemaVersion: "1.0.0";
  auditId: string;
  generatedAt: string;
  status: "available" | "partial" | "limited";
  playlistTargeting: {
    status: "available" | "partial" | "no_matches" | "not_configured" | "unavailable";
    candidates: Array<{
      rank: number;
      provider: "spotify" | "apple_music";
      id: string;
      name: string;
      url: string;
      relationship: "existing_recording_presence" | "genre_mood_aligned_candidate";
      evidenceClass: "RECOGNIZED";
      evidenceRefs: string[];
      matchBasis: string[];
      retrievedAt: string;
      limitation: string;
    }>;
    outcomes: Array<{ provider: string; status: string; reason: string }>;
  };
  territories: {
    status: "available" | "unavailable";
    ranked: Array<{
      rank: number;
      territory: string;
      metric: "listeners" | "streams" | "saves" | "playlist_adds";
      value: number;
      unit: string;
      provider: string;
      retrievedAt: string;
      sourceUrl: string;
      evidenceClass: "RECOGNIZED" | "RECONCILED";
      evidenceRefs: string[];
    }>;
    contextTags: string[];
    reason: string;
  };
  shortFormHooks: {
    status: "available" | "unavailable";
    method: "windowed_energy_and_spectral_flux_v1";
    timingBasis: "acoustic_window_midpoint_estimate";
    candidates: Array<{
      id: string;
      rank: number;
      startSeconds: number;
      endSeconds: number;
      relativePriority: number;
      rmsDbfs: number;
      spectralFlux: number;
      evidenceRefs: string[];
      evidenceClass: "OBSERVED";
      limitation: string;
    }>;
    reason: string | null;
  };
  positioning: {
    djClub: {
      status: "hypothesis" | "unavailable";
      rationale: string;
      evidenceRefs: string[];
      evidenceClass: "INFERRED";
    };
    sync: {
      status: "hypothesis" | "unavailable";
      rationale: string;
      evidenceRefs: string[];
      evidenceClass: "INFERRED";
      rightsClearance: "unverified";
    };
  };
  rollout: {
    preRelease: MarketPlacementAction[];
    releaseWindow: MarketPlacementAction[];
    postRelease: MarketPlacementAction[];
    territoryAndPaidMediaGate: string;
  };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unique = (values: readonly string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const validTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));
const isHttps = (value: string): boolean => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

function normalize(values: readonly number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 0);
  return values.map((value) => Math.max(0, Math.min(1, (value - min) / (max - min))));
}

function buildPlaylistTargeting(input: MarketPlacementInput): MarketPlacementResult["playlistTargeting"] {
  const discovery = input.playlistDiscovery;
  if (!discovery) return { status: "unavailable", candidates: [], outcomes: [] };
  const primary = input.genreClassification?.primaryGenre;
  const candidates = discovery.candidates.map((candidate) => {
    const evidenceRefs = ["playlist:" + candidate.provider + ":" + candidate.id];
    if (candidate.containsIsrc === true) evidenceRefs.push("metadata:isrc");
    if (candidate.genreMatches.length && primary) evidenceRefs.push("genre:primary");
    if (candidate.moodMatches.length) evidenceRefs.push("sonic:mood");
    const score = (candidate.containsIsrc === true ? 100 : 0)
      + candidate.genreMatches.length * 20 + candidate.moodMatches.length * 10;
    return {
      candidate,
      score,
      evidenceRefs,
      relationship: candidate.containsIsrc === true
        ? "existing_recording_presence" as const
        : "genre_mood_aligned_candidate" as const,
    };
  }).sort((a, b) => b.score - a.score || a.candidate.provider.localeCompare(b.candidate.provider) || a.candidate.name.localeCompare(b.candidate.name));
  return {
    status: discovery.status,
    candidates: candidates.map(({ candidate, evidenceRefs, relationship }, index) => ({
      rank: index + 1,
      provider: candidate.provider,
      id: candidate.id,
      name: candidate.name,
      url: candidate.url,
      relationship,
      evidenceClass: "RECOGNIZED" as const,
      evidenceRefs,
      matchBasis: [...candidate.matchBasis],
      retrievedAt: candidate.retrievedAt,
      limitation: candidate.containsIsrc === true
        ? "Existing catalogue presence is not an outreach opportunity or proof of campaign impact."
        : "Catalogue similarity is a research lead only; curator interest, an open submission route, placement and audience response are unverified.",
    })),
    outcomes: discovery.outcomes.map((outcome) => ({ ...outcome })),
  };
}

function buildTerritories(input: MarketPlacementInput): MarketPlacementResult["territories"] {
  const contextTags = unique([
    ...(input.genreClassification?.regionTags ?? []),
    ...(input.genreClassification?.sceneTags ?? []),
  ]).sort();
  const telemetry = (input.territoryTelemetry ?? []).filter((item) =>
    item.provider.trim().length > 0
    && /^[A-Z]{2}$/.test(item.territory)
    && finite(item.value) && item.value >= 0
    && item.unit.trim().length > 0
    && validTimestamp(item.retrievedAt)
    && isHttps(item.sourceUrl)
    && ["RECOGNIZED", "RECONCILED"].includes(item.evidenceClass),
  );
  if (!telemetry.length) {
    return {
      status: "unavailable", ranked: [], contextTags,
      reason: "Territory-level audience or performance telemetry with provider, metric, value, unit and retrieval timestamp was not supplied. Region/scene tags are cultural context, not demand evidence.",
    };
  }
  const metrics = unique(telemetry.map((item) => item.metric));
  if (metrics.length !== 1) {
    return {
      status: "unavailable", ranked: [], contextTags,
      reason: "Territory telemetry contains incomparable metric types; a single metric is required before ranking territories.",
    };
  }
  const ranked = [...telemetry].sort((a, b) => b.value - a.value || a.territory.localeCompare(b.territory));
  return {
    status: "available",
    contextTags,
    reason: "Ranked only from supplied provider-attributed territory telemetry; this is not a forecast.",
    ranked: ranked.map((item, index) => ({
      rank: index + 1,
      territory: item.territory,
      metric: item.metric,
      value: item.value,
      unit: item.unit,
      provider: item.provider,
      retrievedAt: item.retrievedAt,
      sourceUrl: item.sourceUrl,
      evidenceClass: item.evidenceClass,
      evidenceRefs: ["territory:" + item.provider + ":" + item.territory + ":" + item.metric],
    })),
  };
}

function buildHooks(input: MarketPlacementInput): MarketPlacementResult["shortFormHooks"] {
  const dna = input.sonicDna;
  const profile = dna?.acousticFeatureProfile;
  const unavailable = (reason: string): MarketPlacementResult["shortFormHooks"] => ({
    status: "unavailable", method: "windowed_energy_and_spectral_flux_v1",
    timingBasis: "acoustic_window_midpoint_estimate", candidates: [], reason,
  });
  if (input.executionMode === "dsp_link" || dna?.provenance !== "uploaded_audio_master") {
    return unavailable("Timestamped hooks require measured evidence from an uploaded audio master; DSP metadata cannot substitute.");
  }
  if (profile?.status !== "measured" || !finite(dna.durationSeconds) || dna.durationSeconds <= 0) {
    return unavailable("A measured acoustic feature profile and valid master duration are required.");
  }
  const windows = (profile.windowSummaries ?? []).filter((window) =>
    finite(window.startSeconds) && finite(window.endSeconds)
    && window.startSeconds >= 0 && window.endSeconds > window.startSeconds
    && window.endSeconds <= dna.durationSeconds!
    && finite(window.rmsDbfs) && finite(window.spectralFlux),
  );
  if (windows.length < 2) return unavailable("At least two valid uploaded-master acoustic windows are required to identify relative energy/onset peaks.");
  const energy = normalize(windows.map((window) => window.rmsDbfs));
  const flux = normalize(windows.map((window) => window.spectralFlux));
  const scored = windows.map((window, index) => ({
    window,
    energy: energy[index] ?? 0,
    flux: flux[index] ?? 0,
    score: 0.4 * (energy[index] ?? 0) + 0.6 * (flux[index] ?? 0),
  })).sort((a, b) => b.score - a.score || a.window.startSeconds - b.window.startSeconds);
  const selected: typeof scored = [];
  const hookLength = Math.min(15, dna.durationSeconds);
  for (const candidate of scored) {
    const midpoint = (candidate.window.startSeconds + candidate.window.endSeconds) / 2;
    const startSeconds = Math.max(0, Math.min(dna.durationSeconds - hookLength, midpoint - hookLength / 2));
    const endSeconds = startSeconds + hookLength;
    if (selected.some((item) => {
      const otherMidpoint = (item.window.startSeconds + item.window.endSeconds) / 2;
      return Math.abs(otherMidpoint - midpoint) < hookLength * 0.6;
    })) continue;
    selected.push(candidate);
    if (selected.length >= 5) break;
  }
  const candidates = selected.map((item, index) => {
    const start = Math.max(0, Math.min(dna.durationSeconds! - hookLength,
      (item.window.startSeconds + item.window.endSeconds) / 2 - hookLength / 2));
    const end = start + hookLength;
    return {
      id: "hook-" + (index + 1),
      rank: index + 1,
      startSeconds: Number(start.toFixed(3)),
      endSeconds: Number(end.toFixed(3)),
      relativePriority: Number((item.score * 100).toFixed(1)),
      rmsDbfs: Number(item.window.rmsDbfs.toFixed(2)),
      spectralFlux: Number(item.window.spectralFlux.toFixed(6)),
      evidenceRefs: [
        "sonic:acoustic-window:" + item.window.startSeconds.toFixed(3),
        "sonic:energy",
        "sonic:onset",
      ],
      evidenceClass: "OBSERVED" as const,
      limitation: "Window-ranked edit candidate only; timestamps are estimated from sampled acoustic windows and require human listening/edit approval. Engagement is not predicted.",
    };
  });
  return {
    status: candidates.length ? "available" : "unavailable",
    method: "windowed_energy_and_spectral_flux_v1",
    timingBasis: "acoustic_window_midpoint_estimate",
    candidates,
    reason: candidates.length ? null : "No usable acoustic windows survived validation.",
  };
}

function buildPositioning(input: MarketPlacementInput): MarketPlacementResult["positioning"] {
  const dna = input.sonicDna;
  const reliableTempo = finite(dna?.bpm) && finite(dna?.tempoConfidence) && dna.tempoConfidence >= 0.5;
  const djRefs = reliableTempo ? ["sonic:tempo"] : [];
  if (reliableTempo && dna?.rhythmFeatures?.beatGridStatus === "tentative") djRefs.push("sonic:rhythm-grid");
  if (dna?.key && finite(dna.keyConfidence) && dna.keyConfidence >= 0.5) djRefs.push("sonic:key");
  const djClub = reliableTempo ? {
    status: "hypothesis" as const,
    rationale: "The measured tempo (" + dna!.bpm + " BPM) and available beat-grid/key diagnostics support a DJ-set compatibility hypothesis. This is not evidence of club demand, DJ support or a booking opportunity.",
    evidenceRefs: djRefs,
    evidenceClass: "INFERRED" as const,
  } : {
    status: "unavailable" as const,
    rationale: "Reliable uploaded-master tempo evidence is not available; no DJ/club fit hypothesis is asserted.",
    evidenceRefs: [],
    evidenceClass: "INFERRED" as const,
  };
  const genre = input.genreClassification?.primaryGenre;
  const mood = dna?.acousticFeatureProfile?.predictions?.mood;
  const energy = dna?.acousticFeatureProfile?.predictions?.energy;
  const syncRefs = [
    ...(genre ? ["genre:primary"] : []),
    ...(mood?.status === "provisional" ? ["sonic:mood"] : []),
    ...(energy?.status === "provisional" ? ["sonic:energy"] : []),
  ];
  const sync = syncRefs.length ? {
    status: "hypothesis" as const,
    rationale: "Creative sync-fit hypothesis based on " + [
      genre ? "provider-backed genre lane " + genre : "",
      mood?.status === "provisional" ? "provisional audio mood " + (mood.labels ?? []).join("/") : "",
      energy?.status === "provisional" ? "provisional audio energy " + (energy.label ?? "unclassified") : "",
    ].filter(Boolean).join(", ") + ". This is not a verified brief, sync opportunity, rights record or clearance.",
    evidenceRefs: syncRefs,
    evidenceClass: "INFERRED" as const,
    rightsClearance: "unverified" as const,
  } : {
    status: "unavailable" as const,
    rationale: "No sufficiently attributed genre or uploaded-master mood/energy context is available for a sync creative-fit hypothesis.",
    evidenceRefs: [],
    evidenceClass: "INFERRED" as const,
    rightsClearance: "unverified" as const,
  };
  return { djClub, sync };
}

function buildRollout(input: MarketPlacementInput, playlist: MarketPlacementResult["playlistTargeting"], hooks: MarketPlacementResult["shortFormHooks"]): MarketPlacementResult["rollout"] {
  const preRelease: MarketPlacementAction[] = [];
  const releaseWindow: MarketPlacementAction[] = [];
  const postRelease: MarketPlacementAction[] = [];
  if (hooks.candidates.length) {
    const refs = hooks.candidates.slice(0, 3).map((candidate) => candidate.evidenceRefs[0]!);
    preRelease.push({
      action: "Human-review the highest-ranked short-form hook windows and prepare platform-native edits only after listening approval.",
      evidenceClass: "INFERRED", evidenceRefs: refs,
      limitation: "The acoustic ranking does not predict retention, completion rate or virality.",
    });
  }
  if (playlist.candidates.length) {
    const refs = playlist.candidates.slice(0, 3).map((candidate) => candidate.evidenceRefs[0]!);
    preRelease.push({
      action: "Research the listed genre/mood-aligned playlist candidates and verify each official submission route and current requirements before outreach.",
      evidenceClass: "INFERRED", evidenceRefs: refs,
      limitation: "A playlist URL is not a curator contact, submission route, acceptance or placement.",
    });
    releaseWindow.push({
      action: "Use the verified submission routes, if available after manual checking, to pitch only the best-supported playlist matches.",
      evidenceClass: "INFERRED", evidenceRefs: refs,
      limitation: "No outreach or placement is represented as completed by this report.",
    });
  }
  if (hooks.candidates.length) {
    releaseWindow.push({
      action: "Test approved short-form edits during the release window and evaluate platform analytics before changing creative or spend.",
      evidenceClass: "INFERRED", evidenceRefs: hooks.candidates.slice(0, 3).map((candidate) => candidate.evidenceRefs[0]!),
      limitation: "No audience response or conversion data is supplied by the audio analysis.",
    });
  }
  const strategyRefs = [
    ...(input.identity.isrc ? ["metadata:isrc"] : []),
    ...(input.genreClassification?.primaryGenre ? ["genre:primary"] : []),
  ];
  const practiceRefs = ["industry-practice:release-cycle"];
  postRelease.push({
    action: "Review newly collected DSP and campaign telemetry by territory, platform and creative before reallocating effort or declaring a winning market.",
    evidenceClass: "INDUSTRY PRACTICE", evidenceRefs: strategyRefs.length ? strategyRefs : practiceRefs,
    limitation: "No post-release performance result is forecast or claimed.",
  });
  if (!preRelease.length) {
    preRelease.push({
      action: "Complete identity, rights and audience-data checks before selecting playlist, territory or paid-media targets.",
      evidenceClass: "INDUSTRY PRACTICE", evidenceRefs: practiceRefs,
      limitation: "No track-specific target is asserted where supporting evidence is absent.",
    });
  }
  if (!releaseWindow.length) {
    releaseWindow.push({
      action: "Use the release window to collect first-party platform analytics and reconcile DSP reporting before scaling activity.",
      evidenceClass: "INDUSTRY PRACTICE", evidenceRefs: practiceRefs,
      limitation: "No audience, conversion or campaign outcome is predicted.",
    });
  }
  return {
    preRelease, releaseWindow, postRelease,
    territoryAndPaidMediaGate: "BLOCKED: do not rank territories or recommend paid-media allocation until provider-verified territory-level audience/performance telemetry is available.",
  };
}

export function buildMarketPlacementStrategy(input: MarketPlacementInput): MarketPlacementResult {
  const playlistTargeting = buildPlaylistTargeting(input);
  const territories = buildTerritories(input);
  const shortFormHooks = buildHooks(input);
  const positioning = buildPositioning(input);
  const rollout = buildRollout(input, playlistTargeting, shortFormHooks);
  const availableCount = [
    playlistTargeting.candidates.length > 0,
    territories.status === "available",
    shortFormHooks.status === "available",
    positioning.djClub.status === "hypothesis" || positioning.sync.status === "hypothesis",
  ].filter(Boolean).length;
  return {
    schemaVersion: "1.0.0",
    auditId: input.auditId,
    generatedAt: input.generatedAt,
    status: availableCount >= 3 ? "available" : availableCount > 0 ? "partial" : "limited",
    playlistTargeting,
    territories,
    shortFormHooks,
    positioning,
    rollout,
  };
}
