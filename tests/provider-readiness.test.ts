import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { getProviderReadiness, markProviderAvailable, markProviderUnavailable } from "../src/providers/provider-readiness.js";

afterEach(() => {
  vi.unstubAllEnvs();
  markProviderAvailable("groq");
  markProviderAvailable("gemini");
  markProviderAvailable("ollama");
  markProviderAvailable("audd");
  markProviderAvailable("tidal");
});

describe("provider readiness", () => {
  it("distinguishes policy-disabled providers from missing credentials", () => {
    const readiness = getProviderReadiness({
      PROVIDER_ENABLED_GROQ: "false",
      GROQ_API: "configured",
      PROVIDER_ENABLED_GEMINI: "true",
    });
    expect(readiness.find((item) => item.provider === "groq")).toMatchObject({
      enabled: false, status: "disabled_by_data_policy", credentialConfigured: true,
    });
    expect(readiness.find((item) => item.provider === "gemini")).toMatchObject({
      enabled: false, status: "missing_credentials", credentialConfigured: false,
    });
  });

  it("marks authentication failures unavailable until a successful provider response", () => {
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "true");
    vi.stubEnv("GROQ_API", "configured");
    markProviderUnavailable("groq", "authentication");
    expect(getProviderReadiness().find((item) => item.provider === "groq")).toMatchObject({
      enabled: false, status: "unavailable_authentication", credentialConfigured: true,
    });
    markProviderAvailable("groq");
    expect(getProviderReadiness().find((item) => item.provider === "groq")?.status).toBe("ready");
  });

  it("exposes provider readiness from the HTTP health endpoint without returning credentials", async () => {
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "true");
    vi.stubEnv("GROQ_API", "never-return-this");
    const app = buildServer({
      createJobDependencies: () => ({} as never),
      getAuditStatus: async () => ({ jobId: "unused", status: "queued", currentStepIndex: 0, full: { available: false } }),
      getAuditReport: async () => ({ bytes: new Uint8Array(), contentType: "application/pdf", filename: "unused.pdf" }),
    });
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      const payload = response.json() as { providers: Array<{ provider: string; status: string; credentialConfigured: boolean; [key: string]: unknown }> };
      expect(response.statusCode).toBe(200);
      expect(payload.providers.find((item) => item.provider === "groq")).toMatchObject({
        status: "ready", credentialConfigured: true,
      });
      expect(JSON.stringify(payload)).not.toContain("never-return-this");
    } finally {
      await app.close();
    }
  });
});
