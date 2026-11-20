import { describe, expect, it } from "vitest";
import { buildMarketPlacementPlan } from "../src/strategy/market-placement.js";

const master = {
  provenance: "uploaded_audio_master",
  durationSeconds: 180,
  bpm: 120,
  tempoConfidence: 0.86,
  key: "A",
  mode: "minor",
  rhythmFeatures: {
    beatGridStatus: "tentative",
    onsetEnvelope: [0.05, 0.1, 0.18, 0.92, 0.3, 0.1, 0.08, 0.72, 0.2, 0.1, 0.05, 0.1],
  },
  acousticFeatureProfile: {
    predictions: {
      energy: { status: "provisional", label: "high", score: 78, probability: null },
      mood: { status: "provisional", labels: ["driving", "warm"], probability: null },
    },
    windowSummaries: [
      { startSeconds: 42, endSeconds: 42.05, rmsDbfs: -8 },
      { startSeconds: 112, endSeconds: 112.05, rmsDbfs: -10 },
    ],
  },
};

const playlists = {
  status: "available",
  candidates: [
    {
      provider: "spotify", id: "sp-1", name: "Afrobeats Select", url: "https://open.spotify.com/playlist/sp-1",
      retrievedAt: "2026-11-20T10:00:00.000Z", containsIsrc: null,
      genreMatches: ["Afrobeats"], moodMatches: ["driving"], matchBasis: ["Primary genre match: Afrobeats"],
    },
    {
      provider: "apple_music", id: "am-1", name: "Track already included", url: "https://music.apple.com/ng/playlist/am-1",
      retrievedAt: "2026-11-20T10:00:00.000Z", containsIsrc: true,
      genreMatches: ["Afrobeats"], moodMatches: [], matchBasis: ["The audited recording ISRC is already present in this playlist"],
    },
  ],
  outcomes: [],
};

describe("Phase 5 market placement strategy", () => {
  it("ranks provider-returned playlist targets by exact ISRC presence before similarity-only matches", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "combined",
      evidence: { isrc: "NGABC2600001", rightsStatus: "unknown" },
      sonicDna: master,
      playlistDiscovery: playlists,
    });
    expect(plan.playlistTargets[0]).toMatchObject({
      provider: "apple_music",
      name: "Track already included",
      matchStatus: "isrc_present",
    });
    expect(plan.playlistTargets[1]).toMatchObject({
      provider: "spotify",
      name: "Afrobeats Select",
      matchStatus: "membership_unverified",
    });
    expect(plan.playlistTargets[0].limitations.join(" ")).toMatch(/does not establish curator interest/i);
  });

  it("does not invent territory priorities when verified audience geography is absent", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "combined",
      evidence: { isrc: "NGABC2600001" },
      sonicDna: master,
      playlistDiscovery: playlists,
    });
    expect(plan.territoryPriorities).toMatchObject({
      status: "unavailable",
      territories: [],
    });
    expect(plan.territoryPriorities.reason).toMatch(/verified territory-level audience telemetry/i);
  });

  it("ranks territories only from verified, provider-attributed audience telemetry with a reporting period", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "combined",
      evidence: {
        audienceTelemetry: {
          verified: true,
          provider: "spotify",
          metric: "monthly_listeners",
          reportingPeriod: "2026-10-01/2026-10-31",
          retrievedAt: "2026-11-01T00:00:00.000Z",
          territories: [
            { countryCode: "NG", value: 1200 },
            { countryCode: "GB", value: 3000 },
          ],
        },
      },
      sonicDna: master,
      playlistDiscovery: playlists,
    });
    expect(plan.territoryPriorities).toMatchObject({
      status: "available",
      provider: "spotify",
      metric: "monthly_listeners",
      reportingPeriod: "2026-10-01/2026-10-31",
      territories: [{ countryCode: "GB", value: 3000 }, { countryCode: "NG", value: 1200 }],
    });
  });

  it("creates bounded timestamped short-form edit candidates from master onset and energy peaks", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "master",
      evidence: {},
      sonicDna: master,
    });
    expect(plan.shortFormHooks.status).toBe("available");
    expect(plan.shortFormHooks.segments.length).toBeGreaterThan(0);
    expect(plan.shortFormHooks.segments.length).toBeLessThanOrEqual(3);
    for (const segment of plan.shortFormHooks.segments) {
      expect(segment.startSeconds).toBeGreaterThanOrEqual(0);
      expect(segment.endSeconds).toBeLessThanOrEqual(180);
      expect(segment.endSeconds - segment.startSeconds).toBe(12);
      expect(segment.score).toBeGreaterThanOrEqual(0);
      expect(segment.score).toBeLessThanOrEqual(100);
    }
    expect(plan.shortFormHooks.limitations.join(" ")).toMatch(/edit candidates, not confirmed musical hooks/i);
  });

  it("withholds timestamped hook claims when no uploaded master is present", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "dsp_link",
      evidence: {},
      sonicDna: { ...master, provenance: "RECOGNIZED" },
    });
    expect(plan.shortFormHooks).toMatchObject({ status: "unavailable", segments: [] });
  });

  it("keeps sync positioning blocked until rights and master approval are verified", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "combined",
      evidence: { rightsStatus: "unknown", masterApproved: false },
      sonicDna: master,
    });
    expect(plan.positioning.sync).toMatchObject({ status: "blocked" });
    expect(plan.positioning.sync.reason).toMatch(/rights clearance and approved master/i);
  });

  it("uses tempo and beat-grid evidence for DJ/club review without claiming commercial fit", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "master",
      evidence: {},
      sonicDna: master,
    });
    expect(plan.positioning.dj.status).toBe("review_required");
    expect(plan.positioning.club.status).toBe("review_required");
    expect(plan.positioning.dj.basis.join(" ")).toMatch(/120 BPM/);
    expect(plan.positioning.club.limitations.join(" ")).toMatch(/not evidence of venue demand/i);
  });
  it("rejects malformed country codes and incomplete retrieval timestamps", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "combined",
      evidence: {
        audienceTelemetry: {
          verified: true, provider: "spotify", metric: "monthly_listeners",
          reportingPeriod: "2026-10", retrievedAt: "2026-11-01",
          territories: [{ countryCode: "ZZ", value: 100 }],
        },
      },
      sonicDna: master,
    });
    expect(plan.territoryPriorities.status).toBe("unavailable");
    expect(plan.territoryPriorities.territories).toEqual([]);
  });

  it("withholds hook candidates when windowed RMS context is absent", () => {
    const plan = buildMarketPlacementPlan({
      executionMode: "master",
      evidence: {},
      sonicDna: {
        ...master,
        acousticFeatureProfile: { predictions: master.acousticFeatureProfile.predictions, windowSummaries: [] },
      },
    });
    expect(plan.shortFormHooks).toMatchObject({ status: "unavailable", segments: [] });
    expect(plan.shortFormHooks.limitations.join(" ")).toMatch(/windowed RMS summaries were unavailable/i);
  });

});
