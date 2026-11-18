import { afterEach, describe, expect, it, vi } from "vitest";
import { TidalClient } from "../src/providers/tidal/client.js";
import { getProviderReadiness, markProviderAvailable } from "../src/providers/provider-readiness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  markProviderAvailable("tidal");
});

describe("TIDAL provider readiness", () => {
  it("marks TIDAL unavailable after a non-retryable authentication failure", async () => {
    vi.stubEnv("PROVIDER_ENABLED_TIDAL", "true");
    vi.stubEnv("TIDAL_CLIENT_ID", "test-client");
    vi.stubEnv("TIDAL_CLIENT_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));

    const client = new TidalClient("test-client", "test-secret", "US");
    await expect(client.getTrack("123")).rejects.toThrow("TIDAL token request failed with HTTP 401");
    expect(getProviderReadiness().find((item) => item.provider === "tidal")).toMatchObject({
      enabled: false,
      status: "unavailable_authentication",
      credentialConfigured: true,
    });
  });

  it("requires both TIDAL credentials before reporting readiness", () => {
    expect(getProviderReadiness({
      PROVIDER_ENABLED_TIDAL: "true",
      TIDAL_CLIENT_ID: "configured",
    }).find((item) => item.provider === "tidal")).toMatchObject({
      enabled: false,
      status: "missing_credentials",
      credentialConfigured: false,
    });
  });
});
