import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("commercial provider policy registry", () => {
  it("records commercial status, terms, attribution, retention and a default-off flag for every provider", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(["allowed", "unverified", "denied"]).toContain(policy.commercialStatus);
      expect(policy.termsUrl).toMatch(/^https:\/\//);
      expect(policy.attribution.length).toBeGreaterThan(5);
      expect(policy.retention.length).toBeGreaterThan(5);
      expect(policy.enableFlag).toMatch(/^PROVIDER_ENABLED_[A-Z0-9_]+$/);
    }
  });

  it("does not treat credentials as permission for an unverified provider", () => {
    const decision = providerDecision("spotify", {
      SPOTIFY_CLIENT_ID: "present",
      SPOTIFY_CLIENT_SECRET: "present",
    });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe("disabled by data policy");
  });

  it("does not allow an opt-in flag or credentials to override unverified status", () => {
    const decision = providerDecision("audiomack", {
      AUDIOMACK_CONSUMER_KEY: "present",
      AUDIOMACK_CONSUMER_SECRET: "present",
      PROVIDER_ENABLED_AUDIOMACK: "true",
    });
    expect(decision.enabled).toBe(false);
    expect(decision.commercialStatus).toBe("unverified");
    expect(decision.reason).toBe("disabled by data policy");
  });

  it("keeps denied providers disabled even when their opt-in flag is true", () => {
    const decision = providerDecision("deezer", { PROVIDER_ENABLED_DEEZER: "true" });
    expect(decision.enabled).toBe(false);
    expect(decision.commercialStatus).toBe("denied");
    expect(decision.reason).toBe("disabled by data policy");
  });

  it("enables Groq only with the exact opt-in flag after owner-authorized policy approval", () => {
    const enabled = providerDecision("groq", {
      GROQ_API: "present",
      PROVIDER_ENABLED_GROQ: "true",
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.commercialStatus).toBe("allowed");
    expect(providerDecision("groq", { GROQ_API: "present", PROVIDER_ENABLED_GROQ: "false" }).enabled).toBe(false);
    expect(providerDecision("groq", { GROQ_API: "present" }).enabled).toBe(false);
    expect(providerDecision("groq", { GROQ_API: "present", PROVIDER_ENABLED_GROQ: "TRUE" }).enabled).toBe(false);
  });

  it("enables AudD only with the exact opt-in flag after owner-authorized policy approval", () => {
    const enabled = providerDecision("audd", {
      AUDD_API: "present",
      PROVIDER_ENABLED_AUDD: "true",
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.commercialStatus).toBe("allowed");
    expect(providerDecision("audd", { AUDD_API: "present", PROVIDER_ENABLED_AUDD: "false" }).enabled).toBe(false);
    expect(providerDecision("audd", { AUDD_API: "present" }).enabled).toBe(false);
    expect(providerDecision("audd", { AUDD_API: "present", PROVIDER_ENABLED_AUDD: "TRUE" }).enabled).toBe(false);
  });

  it("surfaces a policy-disabled DSP as unavailable instead of usable metadata", async () => {
    const links = normalizeDspTrackLinks(["https://open.spotify.com/track/spotify-123"]);
    const [result] = await collectDspMetadata(links);
    expect(result?.status).toBe("unavailable");
    expect(result?.error).toBe("disabled by data policy");
    expect(result?.metadata?.raw.providerPolicy).toMatchObject({
      provider: "spotify",
      reason: "disabled by data policy",
    });
  });

  it("allows only a reviewed provider with an exact true opt-in flag", () => {
    expect(providerDecision("musicbrainz", { PROVIDER_ENABLED_MUSICBRAINZ: "true" }).enabled).toBe(true);
    expect(providerDecision("musicbrainz", { PROVIDER_ENABLED_MUSICBRAINZ: "false" }).enabled).toBe(false);
  });

  it("requires an exact true string and does not enable unknown flags", () => {
    expect(providerDecision("groq", { PROVIDER_ENABLED_GROQ: "1" }).enabled).toBe(false);
    expect(providerDecision("groq", { PROVIDER_ENABLED_GROQ: "TRUE" }).enabled).toBe(false);
    expect(providerDecision("groq", {}).enabled).toBe(false);
  });
});
