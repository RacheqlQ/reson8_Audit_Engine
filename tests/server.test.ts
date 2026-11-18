import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
const ACCESS_TOKEN = "a".repeat(64);
const store = {
  verifyAuditAccessToken: async (jobId: string, token: string) => jobId === "job-1" && token === ACCESS_TOKEN,
  createJobDependencies: () => { throw new Error("not used"); },
  getAuditStatus: async () => ({ jobId: "job-1", status: "failed" as const, currentStepIndex: 3, errorCode: "AI_PROVIDER_HTTP_503", errorMessage: "AI assessment: retry later.", full: { available: false } }),
  getAuditReport: async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf", filename: "report.pdf" }),
};
describe("anonymous capability API surface", () => {
  it("does not expose a browser authentication configuration endpoint", async () => {
    const app = buildServer({ createJobDependencies: () => { throw new Error("not used"); }, getAuditStatus: store.getAuditStatus, getAuditReport: store.getAuditReport, verifyAuditAccessToken: store.verifyAuditAccessToken } as any);
    const response = await app.inject({ method: "GET", url: "/v1/auth/config" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
  it("requires the matching job capability before returning audit status", async () => {
    const app = buildServer(store as any);
    const denied = await app.inject({ method: "GET", url: "/v1/audits/job-1" });
    const accepted = await app.inject({ method: "GET", url: "/v1/audits/job-1", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(denied.statusCode).toBe(404);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ jobId: "job-1", status: "failed", currentStepIndex: 3, errorCode: "AI_PROVIDER_HTTP_503", errorMessage: "AI assessment: retry later." });
    expect(accepted.json()).not.toHaveProperty("reportAccessToken");
    expect(accepted.json()).not.toHaveProperty("report_access_token_hash");
    expect(JSON.stringify(accepted.json())).not.toContain(ACCESS_TOKEN);
    await app.close();
  });
  it("exposes provider readiness without returning credential values", async () => {
    vi.stubEnv("GROQ_API", "health-secret-token");
    vi.stubEnv("PROVIDER_ENABLED_GROQ", "false");
    const app = buildServer(store as any);
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json().providers).toContainEqual({
        provider: "groq",
        enabled: false,
        credentialsConfigured: true,
        ready: false,
        reason: "disabled_by_data_policy",
      });
      expect(JSON.stringify(response.json())).not.toContain("health-secret-token");
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });
  it("does not disclose whether a different job exists to a token holder", async () => {
    const app = buildServer(store as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/other-job", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
