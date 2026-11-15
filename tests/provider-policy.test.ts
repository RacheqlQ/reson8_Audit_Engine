import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("commercial provider policy registry", () => {
  it("records terms, attribution, retention and a default-off flag for every provider", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(policy.commercialStatus).toBe("allowed");
      expect(policy.termsUrl).toMatch(/^https:\/\//);
      expect(policy.attribution.length).toBeGreaterThan(5);
      expect(policy.retention.length).toBeGreaterThan(5);
      expect(policy.enableFlag).toMatch(/^PROVIDER_ENABLED_[A-Z0-9_]+$/);
    }
  });

  it("allows every registered provider only with its exact opt-in flag", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(providerDecision(policy.id as keyof typeof PROVIDER_POLICY, {}).enabled).toBe(false);
      expect(providerDecision(policy.id as keyof typeof PROVIDER_POLICY, {
        [policy.enableFlag]: "false",
      }).enabled).toBe(false);
      expect(providerDecision(policy.id as keyof typeof PROVIDER_POLICY, {
        [policy.enableFlag]: "TRUE",
      }).enabled).toBe(false);
      expect(providerDecision(policy.id as keyof typeof PROVIDER_POLICY, {
        [policy.enableFlag]: "true",
      }).enabled).toBe(true);
    }
  });

  it("does not treat credentials as a substitute for the exact opt-in flag", () => {
    const decision = providerDecision("spotify", {
      SPOTIFY_CLIENT_ID: "present",
      SPOTIFY_CLIENT_SECRET: "present",
    });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe("disabled by data policy");
  });

  it("does not let credentials or a non-exact flag enable a provider", () => {
    const decision = providerDecision("audiomack", {
      AUDIOMACK_CONSUMER_KEY: "present",
      AUDIOMACK_CONSUMER_SECRET: "present",
      PROVIDER_ENABLED_AUDIOMACK: "TRUE",
    });
    expect(decision.enabled).toBe(false);
    expect(decision.commercialStatus).toBe("allowed");
    expect(decision.reason).toBe("disabled by data policy");
  });

  it("surfaces a provider without its opt-in flag as unavailable", async () => {
    const links = normalizeDspTrackLinks(["https://open.spotify.com/track/spotify-123"]);
    const [result] = await collectDspMetadata(links);
    expect(result?.status).toBe("unavailable");
    expect(result?.error).toBe("disabled by data policy");
    expect(result?.metadata?.raw.providerPolicy).toMatchObject({
      provider: "spotify",
      reason: "disabled by data policy",
    });
  });

  it("allows a provider with its exact true opt-in flag", () => {
    expect(providerDecision("musicbrainz", {
      PROVIDER_ENABLED_MUSICBRAINZ: "true",
    }).enabled).toBe(true);
    expect(providerDecision("musicbrainz", {
      PROVIDER_ENABLED_MUSICBRAINZ: "false",
    }).enabled).toBe(false);
  });
});
