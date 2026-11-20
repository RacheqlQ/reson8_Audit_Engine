import { describe, expect, it } from "vitest";
import { buildMarketPlacementStrategy, type MarketPlacementInput } from "../src/strategy/market-placement.js";

const base: MarketPlacementInput = {
  auditId: "audit-1",
  generatedAt: "2026-11-20T12:00:00.000Z",
  executionMode: "combined",
  identity: { artist: "Artist", title: "Track", isrc: "USABC1234567" },
  genreClassification: {
    primaryGenre: "Afrobeats",
    adjacentLanes: ["Afro-R&B", "Afropop"],
    confidence: 0.82,
    abstained: false,
    genres: [{ id: "afrobeats", label: "Afrobeats", confidence: 0.82, sources: ["tidal", "apple_music"] }],
    regionTags: ["West Africa"],
    sceneTags: ["Lagos"],
    evidence: { providerCount: 2 },
  },
  playlistDiscovery: {
    status: "available",
    outcomes: [{ provider: "spotify", status: "available", reason: "Public playlist metadata returned." }],
    candidates: [
      {
        provider: "spotify", id: "p1", name: "Afrobeats Current", url: "https://open.spotify.com/playlist/p1",
        sourceUrl: "https://open.spotify.com/playlist/p1", curatorName: "Owner", playlistType: null,
        description: null, trackCount: 20, genreMatches: ["Afrobeats"], moodMatches: [],
        moodSource: null, matchBasis: ["Primary genre match: Afrobeats"], containsIsrc: null,
        retrievedAt: "2026-11-20T11:00:00.000Z",
      },
      {
        provider: "apple_music", id: "p2", name: "Already Included", url: "https://music.apple.com/ng/playlist/already/pl.p2",
        sourceUrl: "https://music.apple.com/ng/playlist/already/pl.p2", curatorName: "Apple Music", playlistType: "editorial",
        description: null, trackCount: 40, genreMatches: ["Afrobeats"], moodMatches: ["Energetic"],
        moodSource: "uploaded_master_provisional_mood", matchBasis: ["The audited recording ISRC is already present in this playlist"],
        containsIsrc: true, retrievedAt: "2026-11-20T11:00:00.000Z",
      },
    ],
  },
  sonicDna: {
    provenance: "uploaded_audio_master",
    durationSeconds: 180,
    bpm: 104,
    tempoConfidence: 0.83,
    key: "A",
    mode: "minor",
    keyConfidence: 0.79,
    moodTags: ["driving", "warm"],
    acousticFeatureProfile: {
      status: "measured",
      predictions: {
        mood: { status: "provisional", labels: ["driving", "warm"], scores: { bright: 10, dark: 20, driving: 85, calm: 5, tense: 15, warm: 75 }, method: "audio_feature_heuristics_v1", probability: null },
        energy: { status: "provisional", label: "high", score: 82, method: "audio_feature_heuristics_v1", probability: null },
      },
      windowSummaries: [
        { startSeconds: 10, endSeconds: 10.05, rmsDbfs: -16, spectralCentroidHz: 2400, spectralFlatness: 0.2, spectralFlux: 0.2 },
        { startSeconds: 30, endSeconds: 30.05, rmsDbfs: -8, spectralCentroidHz: 3200, spectralFlatness: 0.3, spectralFlux: 0.9 },
        { startSeconds: 60, endSeconds: 60.05, rmsDbfs: -10, spectralCentroidHz: 2900, spectralFlatness: 0.25, spectralFlux: 0.7 },
        { startSeconds: 120, endSeconds: 120.05, rmsDbfs: -12, spectralCentroidHz: 2700, spectralFlatness: 0.22, spectralFlux: 0.3 },
      ],
    },
    rhythmFeatures: { beatGridStatus: "tentative", beatTimesSeconds: [0.1, 0.68, 1.26], onsetEnvelope: [0.1, 0.8, 0.2] },
  },
};

describe("Phase 5 market placement strategy", () => {
  it("ranks playlist candidates with exact ISRC presence separately from outreach prospects", () => {
    const result = buildMarketPlacementStrategy(base);
    expect(result.playlistTargeting.candidates[0]).toMatchObject({
      name: "Already Included",
      relationship: "existing_recording_presence",
      evidenceClass: "RECOGNIZED",
    });
    expect(result.playlistTargeting.candidates[1]).toMatchObject({
      name: "Afrobeats Current",
      relationship: "genre_mood_aligned_candidate",
    });
    expect(result.playlistTargeting.candidates[1].evidenceRefs).toContain("genre:primary");
  });

  it("creates bounded timestamped hook candidates only from measured uploaded-master windows", () => {
    const result = buildMarketPlacementStrategy(base);
    expect(result.shortFormHooks.status).toBe("available");
    expect(result.shortFormHooks.candidates[0].startSeconds).toBeGreaterThanOrEqual(0);
    expect(result.shortFormHooks.candidates[0].endSeconds).toBeLessThanOrEqual(180);
    expect(result.shortFormHooks.candidates[0].endSeconds - result.shortFormHooks.candidates[0].startSeconds).toBe(15);
    expect(result.shortFormHooks.candidates[0].evidenceRefs).toContain("sonic:acoustic-window:30.000");
    expect(result.shortFormHooks.candidates[0].timingBasis).toBe("acoustic_window_midpoint_estimate");
  });

  it("does not infer territory demand from genre region or scene tags", () => {
    const result = buildMarketPlacementStrategy(base);
    expect(result.territories).toMatchObject({
      status: "unavailable",
      ranked: [],
    });
    expect(result.territories.reason).toMatch(/territory-level audience or performance telemetry/i);
    expect(result.territories.contextTags).toEqual(["Lagos", "West Africa"]);
  });

  it("ranks territories only from source-attributed, timestamped provider telemetry", () => {
    const result = buildMarketPlacementStrategy({
      ...base,
      territoryTelemetry: [
        { provider: "spotify", territory: "NG", metric: "listeners", value: 1200, unit: "listeners", retrievedAt: "2026-11-20T11:00:00.000Z", sourceUrl: "https://provider.example/territories", evidenceClass: "RECOGNIZED" },
        { provider: "spotify", territory: "GB", metric: "listeners", value: 800, unit: "listeners", retrievedAt: "2026-11-20T11:00:00.000Z", sourceUrl: "https://provider.example/territories", evidenceClass: "RECOGNIZED" },
      ],
    });
    expect(result.territories.status).toBe("available");
    expect(result.territories.ranked.map((item) => item.territory)).toEqual(["NG", "GB"]);
  });

  it("keeps DJ/club and sync fit as hypotheses and never implies rights clearance", () => {
    const result = buildMarketPlacementStrategy(base);
    expect(result.positioning.djClub.status).toBe("hypothesis");
    expect(result.positioning.djClub.evidenceRefs).toContain("sonic:tempo");
    expect(result.positioning.sync.status).toBe("hypothesis");
    expect(result.positioning.sync.rightsClearance).toBe("unverified");
  });

  it("withholds master-derived hooks for metadata-only audits", () => {
    const result = buildMarketPlacementStrategy({ ...base, executionMode: "dsp_link" });
    expect(result.shortFormHooks.status).toBe("unavailable");
    expect(result.shortFormHooks.candidates).toEqual([]);
    expect(result.shortFormHooks.reason).toMatch(/uploaded master/i);
  });

  it("creates phased rollout actions with explicit evidence references and telemetry limits", () => {
    const result = buildMarketPlacementStrategy(base);
    expect(result.rollout.preRelease.length).toBeGreaterThan(0);
    expect(result.rollout.releaseWindow.length).toBeGreaterThan(0);
    expect(result.rollout.postRelease.length).toBeGreaterThan(0);
    expect(result.rollout.territoryAndPaidMediaGate).toMatch(/blocked/i);
    expect(result.rollout.preRelease.every((action) => action.evidenceRefs.length > 0)).toBe(true);
  });
});
