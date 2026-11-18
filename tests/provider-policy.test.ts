import { describe, expect, it } from "vitest";
import { PROVIDER_POLICY, providerDecision } from "../src/providers/provider-policy.js";
import { collectDspMetadata } from "../src/providers/dsp/registry.js";
import { normalizeDspTrackLinks } from "../src/providers/dsp/intake.js";

describe("provider authorization registry", () => {
  it("records terms, attribution and retention for every registered source", () => {
    for (const policy of Object.values(PROVIDER_POLICY)) {
      expect(policy.commercialStatus).toBe("allowed");
      expect(policy.termsUrl).toMatch(/^https:\/\//);
      expect(policy.attribution.length).toBeGreaterThan(5);
      expect(policy.retention.length).toBeGreaterThan(5);
      expect(policy).not.toHaveProperty("enableFlag");
    }
  });

  it("authorizes every explicitly approved source from the registry without environment opt-in flags", () => {
    for (const provider of Object.keys(PROVIDER_POLICY) as Array<keyof typeof PROVIDER_POLICY>) {
      expect(providerDecision(provider)).toMatchObject({ enabled: true, reason: null, commercialStatus: "allowed" });
    }
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
