import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";

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

  it("requires an exact true string and does not enable unknown flags", () => {
    expect(providerDecision("groq", { PROVIDER_ENABLED_GROQ: "1" }).enabled).toBe(false);
    expect(providerDecision("groq", { PROVIDER_ENABLED_GROQ: "TRUE" }).enabled).toBe(false);
    expect(providerDecision("groq", {}).enabled).toBe(false);
  });
});
