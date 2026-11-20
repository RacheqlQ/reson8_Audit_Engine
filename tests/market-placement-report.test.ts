import { describe, expect, it } from "vitest";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { buildMarketPlacementPlan } from "../src/strategy/market-placement.js";
import { planAuditReportPages, type AuditReportInput } from "../src/reports/generate-audit-report.js";

describe("Phase 5 report integration", () => {
  it("renders market placement, withheld geography, timestamped edit candidates and gated rollout", () => {
    const input = structuredClone(fullAudioFixture) as unknown as AuditReportInput;
    input.marketPlacement = buildMarketPlacementPlan({
      executionMode: "master",
      evidence: input.evidence,
      sonicDna: input.sonicDna,
      playlistDiscovery: input.evidence.playlistDiscovery as Record<string, unknown> | undefined,
    });
    const pages = planAuditReportPages(input, "full");
    const text = pages.flatMap((page) => [page.title, ...page.text]).join(" ");
    expect(text).toContain("Executive market placement and DSP targeting");
    expect(text).toContain("Territory prioritization");
    expect(text).toContain("No verified territory-level audience telemetry");
    expect(text).toContain("Timestamped short-form edit candidates");
    expect(text).toContain("DJ, club and sync positioning");
    expect(text).toContain("360-degree marketing rollout");
    expect(text).toContain("Rights and identity verified");
    expect(text).not.toMatch(/guaranteed playlist placement|guaranteed audience growth/i);
  });
});
