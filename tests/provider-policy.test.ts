import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("commercial provider policy registry", () => {
  it("records terms, attribution, retention and an explicit commercial status for every provider", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(["allowed", "unverified", "denied"]).toContain(policy.commercialStatus);
      expect(policy.termsUrl).toMatch(/^https:\/\//);
      expect(policy.attribution.length).toBeGreaterThan(5);
      expect(policy.retention.length).toBeGreaterThan(5);
    }
  });

  it("enables operationally authorized providers without per-provider environment flags", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      const decision = providerDecision(policy.id as keyof typeof PROVIDER_POLICY, {});
      expect(decision.enabled).toBe(policy.commercialStatus === "allowed");
      expect(decision.reason).toBe(policy.commercialStatus === "allowed" ? null : "disabled by data policy");
    }
  });

  it("does not let credentials promote an unverified or denied provider", () => {
    expect(providerDecision("deezer", { DEEZER_API_KEY: "present" }).enabled).toBe(false);
    expect(providerDecision("essentia", { ESSENTIA_MODEL_PATH: "present" }).enabled).toBe(false);
  });

  it("allows approved providers without per-provider enable flags", () => {
    expect(providerDecision("spotify", { SPOTIFY_CLIENT_ID: "present", SPOTIFY_CLIENT_SECRET: "present" }).enabled).toBe(true);
    expect(providerDecision("groq", { GROQ_API: "present" }).enabled).toBe(true);
    expect(providerDecision("musicbrainz", {}).enabled).toBe(true);
  });

  it("surfaces provider status as unavailable only when its registry status is not allowed", async () => {
    const links = normalizeDspTrackLinks(["https://open.spotify.com/track/spotify-123"]);
    const [result] = await collectDspMetadata(links);
    expect(result?.status).toBe("unavailable");
    expect(result?.error).toMatch(/Spotify client credentials are required/);
  });
});
