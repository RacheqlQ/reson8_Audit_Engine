import { describe, expect, it } from "vitest";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { planAuditReportPages } from "../src/reports/generate-audit-report.js";

describe("Full report curator campaign section", () => {
  it("states that no curator targets are verified when no sourced target records exist", () => {
    const input = {
      ...fullAudioFixture,
      evidence: { ...fullAudioFixture.evidence, curatorTargets: [] },
    };
    const section = planAuditReportPages(input, "full").find(
      (page) => page.title === "Curator campaign and target verification",
    );

    expect(section).toBeDefined();
    expect(section.text.join(" ")).toContain("NO VERIFIED CURATOR OR PLAYLIST TARGETS");
    expect(section.text.join(" ")).toContain("playlist categories are discovery hypotheses");
    expect(section.text.join(" ")).toContain("Pitch packet");
    expect(section.text.join(" ")).toContain("Outreach log");
  });

  it("renders a target only when source, fit, route, requirements and verification date are present", () => {
    const input = {
      ...fullAudioFixture,
      evidence: {
        ...fullAudioFixture.evidence,
        curatorTargets: [{
          status: "verified",
          name: "Fixture Curator",
          platform: "Spotify",
          sourceUrl: "https://example.com/curator",
          fitRationale: "Fixture-only rationale for testing the source-backed target layout.",
          submissionRoute: "https://example.com/submit",
          submissionRequirements: "Fixture-only requirement list",
          verifiedAt: "2026-11-15",
        }],
      },
    };
    const section = planAuditReportPages(input, "full").find(
      (page) => page.title === "Curator campaign and target verification",
    );

    expect(section).toBeDefined();
    expect(section.text.join(" ")).toContain("Fixture Curator");
    expect(section.text.join(" ")).toContain("https://example.com/curator");
  });


  it("rejects non-HTTPS source or submission links and invalid verification dates", () => {
    const input = {
      ...fullAudioFixture,
      evidence: {
        ...fullAudioFixture.evidence,
        curatorTargets: [{
          status: "verified",
          name: "Unsafe Fixture Target",
          platform: "Spotify",
          sourceUrl: "http://example.com/target",
          fitRationale: "Fixture rationale",
          submissionRoute: "Email the curator",
          submissionRequirements: "Fixture requirements",
          verifiedAt: "not-a-date",
        }],
      },
    };
    const section = planAuditReportPages(input, "full").find(
      (page) => page.title === "Curator campaign and target verification",
    );

    expect(section).toBeDefined();
    expect(section.text.join(" ")).not.toContain("Unsafe Fixture Target");
    expect(section.text.join(" ")).toContain("NO VERIFIED CURATOR OR PLAYLIST TARGETS");
  });

  it("does not render incomplete target records as verified curator recommendations", () => {
    const input = {
      ...fullAudioFixture,
      evidence: {
        ...fullAudioFixture.evidence,
        curatorTargets: [{
          status: "verified",
          name: "Unverified Fixture Target",
          platform: "Spotify",
          sourceUrl: "https://example.com/target",
        }],
      },
    };
    const section = planAuditReportPages(input, "full").find(
      (page) => page.title === "Curator campaign and target verification",
    );

    expect(section).toBeDefined();
    expect(section.text.join(" ")).not.toContain("Unverified Fixture Target");
    expect(section.text.join(" ")).toContain("NO VERIFIED CURATOR OR PLAYLIST TARGETS");
  });
});
