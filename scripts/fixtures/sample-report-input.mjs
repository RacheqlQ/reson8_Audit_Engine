export const sampleReportInput = {
  auditId: "fixture-metadata-audit",
  generatedAt: "2026-11-09T00:00:00.000Z",
  evidence: {
    auditType: "METADATA-BASED AUDIT",
    status: "verified",
    artist: "Fixture Artist",
    title: "Fixture Track",
    album: "Fixture EP",
    releaseDate: "2026-10-01",
    label: "Independent",
    isrc: "NGABC2600001",
    platform: "tidal",
    catalogPopularity: 0.61,
    catalogPopularityScale: "0_1",
    sources: ["tidal_catalog_metadata"],
    identity: {
      artist: "Fixture Artist",
      title: "Fixture Track",
      sourceProviders: ["tidal"],
    },
    reconciliation: {
      status: "partial",
      reconciledFields: ["artist", "title"],
      conflicts: [],
    },
  },
  sonicDna: {
    provenance: "tidal_catalog_metadata",
    bpm: 96,
    key: null,
    mode: null,
    loudnessLufs: null,
    rmsEnergy: null,
    dynamicRangeDb: null,
    spectralCentroidHz: null,
    spectralBandwidthHz: null,
    spectralRolloffHz: null,
    zeroCrossingRate: null,
    moodTags: ["Energetic"],
    genreContext: ["R&B"],
  },
  assessment: {
    assessmentVersion: "2.0",
    executiveSummary: "The fixture contains verified catalog identity and provider-supplied sonic metadata. It supports a preliminary creative positioning hypothesis, but it does not contain master-derived audio measurements or verified audience-performance data.",
    creativeIdentity: "The supplied catalog context suggests a groove-led R&B direction. This is a provisional creative interpretation of the provider metadata and should not be mistaken for a measured genre classification or audience preference.",
    strengths: [
      "The artist and title are present in the catalog identity supplied for this fixture.",
      "The provider exposes a tempo value that can inform preliminary rhythmic positioning.",
      "The catalog metadata includes a platform source that can be traced in the evidence record.",
    ],
    risks: [
      "The audit has no uploaded master, so audio measurements and detailed production analysis are unavailable.",
      "No verified listener, streaming, revenue, or playlist-conversion data is present in this fixture.",
    ],
    aAndRPositioning: {
      primaryLane: "R&B",
      adjacentLanes: ["Alternative R&B"],
      rationale: "The provider-supplied genre context and tempo can inform an initial A&R discovery hypothesis. The available metadata is not sufficient to confirm the final genre lane or predict audience response, so this positioning requires listening review and audience validation.",
    },
    commercialRead: {
      marketability: "undetermined",
      rationale: "The fixture contains no verified audience telemetry, streaming performance, sales, revenue, or playlist-conversion evidence. Catalog popularity is a provider-specific indicator and cannot be substituted for commercial performance, so marketability remains undetermined.",
    },
    releaseStrategy: {
      recommendation: "Use the verified catalog identity to prepare a preliminary release brief, then validate the sonic direction against the full recording and collect real campaign telemetry before making commercial or audience claims.",
      priorities: [
        "Confirm the final artist, title, release date, label, and ISRC against the distributor's release record.",
        "Review the complete master before finalizing the creative lane or production commentary.",
        "Collect verified streaming, audience, and campaign measurements before evaluating commercial traction.",
      ],
    },
    evidenceGaps: [
      "No uploaded audio master or master-derived Sonic DNA measurements are available.",
      "No verified audience telemetry or commercial performance data was supplied.",
    ],
    confidence: 0.68,
    limitations: [
      "This fixture is metadata-based and does not contain direct audio analysis.",
      "The assessment is constrained to the supplied catalog metadata and cannot establish listener demand.",
    ],
    scorecard: {
      sonicIdentity: {
        score: null,
        rationale: "No master-derived measurements are available in this metadata-only fixture. A numeric sonic identity score would overstate the evidence, so this dimension remains unscored until the recording is analyzed.",
      },
      metadataIntegrity: {
        score: 70,
        rationale: "Artist and title are present and linked to a named catalog source, but the fixture does not independently verify every release field. The score reflects partial metadata coverage only.",
      },
      commercialEvidence: {
        score: null,
        rationale: "No verified streams, listeners, sales, revenue, or playlist conversion data is present. A commercial score cannot be responsibly calculated from catalog popularity alone, so this dimension remains unscored.",
      },
      releaseReadiness: {
        score: 45,
        rationale: "The catalog identity supports initial preparation, but master review, release-field confirmation, and audience evidence are still outstanding. The score reflects the current evidence readiness, not predicted release success.",
      },
    },
    evidenceLabels: [
      {
        label: "RECOGNIZED",
        claim: "The artist and title are represented in the supplied catalog metadata record.",
        source: "tidal_catalog_metadata",
      },
      {
        label: "OBSERVED",
        claim: "The provider metadata reports a tempo value of 96 BPM for this track.",
        source: "sonicDna.bpm",
      },
      {
        label: "INFERRED",
        claim: "The proposed R&B lane is a provisional creative interpretation of the supplied catalog context.",
        source: "sonicDna.genreContext",
      },
    ],
  },
};
