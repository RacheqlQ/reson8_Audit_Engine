import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("provider authorization registry", () => {
  it("records terms, attribution and retention for every registered source", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(policy.commercialStatus).toBe(policy.id === "musicbrainz" ? "unverified" : "allowed");
      expect(policy.termsUrl).toMatch(/^https:\/\//);
      expect(policy.attribution.length).toBeGreaterThan(5);
      expect(policy.retention.length).toBeGreaterThan(5);
      expect(policy).not.toHaveProperty("enableFlag");
    }
  });

  it("authorizes every explicitly approved source from the registry without environment opt-in flags", () => {
    for (const provider of Object.keys(PROVIDER_POLICY) as Array<keyof typeof PROVIDER_POLICY>) {
      if (provider === "musicbrainz") {
        expect(providerDecision(provider)).toMatchObject({ enabled: true, reason: null, commercialStatus: "unverified" });
      } else {
        expect(providerDecision(provider)).toMatchObject({ enabled: true, reason: null, commercialStatus: "allowed" });
      }
    }
  });

  it("enables MusicBrainz for evaluation while preserving unverified commercial status", () => {
    expect(PROVIDER_POLICY.musicbrainz.operationalEnabled).toBe(true);
    expect(PROVIDER_POLICY.musicbrainz.commercialStatus).toBe("unverified");
    expect(PROVIDER_POLICY.musicbrainz.decisionNote).toMatch(/evaluation.*commercial-use permission remains unverified/i);
  });

  it("does not confuse missing integration credentials with a policy denial", async () => {
    const links = normalizeDspTrackLinks(["https://open.spotify.com/track/spotify-123"]);
    const [result] = await collectDspMetadata(links);
    expect(result?.status).toBe("unavailable");
    expect(result?.error).toMatch(/Spotify client credentials are required/);
    expect(result?.metadata?.raw).not.toHaveProperty("providerPolicy");
    expect(providerDecision("spotify").enabled).toBe(true);
  });
});
