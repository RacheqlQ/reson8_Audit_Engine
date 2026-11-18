import { afterEach, describe, expect, it } from "vitest";
import { getAssessmentProviderReadiness, markAssessmentProviderUnavailable, PROVIDER_POLICY, providerDecision, resetAssessmentProviderRuntimeState } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("commercial provider policy registry", () => {
  afterEach(() => resetAssessmentProviderRuntimeState());
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

  it("reports assessment provider readiness without exposing credentials", () => {
    const readiness = getAssessmentProviderReadiness({
      PROVIDER_ENABLED_GROQ: "true",
      GROQ_API: "secret-groq-token",
      PROVIDER_ENABLED_GEMINI: "true",
      GEMINI_API_KEY: "",
      PROVIDER_ENABLED_OLLAMA: "false",
      OLLAMA_API_KEY: "secret-ollama-token",
    });
    expect(readiness).toEqual([
      { provider: "groq", enabled: true, credentialsConfigured: true, ready: true, reason: "ready" },
      { provider: "gemini", enabled: true, credentialsConfigured: false, ready: false, reason: "credentials_missing" },
      { provider: "ollama", enabled: false, credentialsConfigured: true, ready: false, reason: "disabled_by_data_policy" },
    ]);
    expect(JSON.stringify(readiness)).not.toContain("secret-");
  });

  it("marks authentication-failed providers unavailable in subsequent readiness checks", () => {
    const env = {
      PROVIDER_ENABLED_GROQ: "true",
      GROQ_API: "never-return-this-token",
    };
    expect(providerDecision("groq", env).enabled).toBe(true);
    markAssessmentProviderUnavailable("groq", "authentication_failed");
    expect(providerDecision("groq", env)).toMatchObject({
      enabled: false,
      reason: "authentication_failed",
    });
    expect(getAssessmentProviderReadiness(env)).toContainEqual({
      provider: "groq",
      enabled: false,
      credentialsConfigured: true,
      ready: false,
      reason: "authentication_failed",
    });
    expect(JSON.stringify(getAssessmentProviderReadiness(env))).not.toContain("never-return-this-token");
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
