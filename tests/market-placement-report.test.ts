import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { buildMarketPlacementPlan } from "../src/strategy/market-placement.js";
import { generateAuditReport, planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";

describe("Phase 5 report integration", () => {
  it("renders market placement, withheld geography, timestamped edit candidates and gated rollout", async () => {
    const input = structuredClone(fullAudioFixture) as unknown as AuditReportInput;
    input.evidence.playlistDiscovery = {
      moodTagsUsed: ["driving"],
      moodSource: "DSP catalogue sonic profile; uploaded-master provisional audio_feature_heuristics_v1",
      outcomes: [],
      candidates: [
        { provider: "apple_music", id: "existing-1", name: "Existing ISRC Presence", url: "https://music.apple.com/ng/playlist/existing-1", containsIsrc: true, genreMatches: [], moodMatches: [], matchBasis: ["The audited recording ISRC is already present in this playlist"], retrievedAt: "2026-11-20T10:00:00.000Z" },
        { provider: "spotify", id: "target-1", name: "Genre Target Lead", url: "https://open.spotify.com/playlist/target-1", containsIsrc: null, genreMatches: ["Afrobeats"], moodMatches: ["driving"], matchBasis: ["Primary genre match: Afrobeats"], retrievedAt: "2026-11-20T10:00:00.000Z" },
      ],
    };
    input.marketPlacement = buildMarketPlacementPlan({
      executionMode: "master",
      evidence: input.evidence,
      sonicDna: input.sonicDna,
      playlistDiscovery: input.evidence.playlistDiscovery as Record<string, unknown>,
    });
    const pages = planAuditReportPages(input, "full");
    const text = pages.flatMap((page) => [page.title, ...page.text]).join(" ");
    expect(text).toContain("Executive market placement and DSP targeting");
    expect(text).toContain("EXISTING ISRC PRESENCE — not an outreach prospect");
    expect(text).toContain("TARGET SHORTLIST — membership absent or unverified");
    expect(text).toContain("candidate-track BPM, key, energy and acoustic feature vectors");
    expect(text).toContain("provisional audio_feature_heuristics_v1 outputs, not calibrated perceptual predictions");
    expect(text).toContain("Territory prioritization");
    expect(text).toContain("No verified territory-level audience telemetry");
    expect(text).toContain("Timestamped short-form edit candidates");
    expect(text).toContain("DJ, club and sync positioning");
    expect(text).toContain("360-degree marketing rollout");
    expect(text).toContain("Rights and identity verified");
    expect(text).not.toMatch(/guaranteed playlist placement|guaranteed audience growth/i);
    const pdf = await PDFDocument.load(await generateAuditReport(input, "full"));
    expect(pdf.getPageCount()).toBeLessThanOrEqual(20);
  });
});
