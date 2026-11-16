import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
const ACCESS_TOKEN = "a".repeat(64);
const store = {
  verifyAuditAccessToken: async (jobId: string, token: string) => jobId === "job-1" && token === ACCESS_TOKEN,
  createJobDependencies: () => { throw new Error("not used"); },
  getAuditStatus: async () => ({ jobId: "job-1", status: "completed" as const, currentStepIndex: 4, full: { available: true, version: 1 } }),
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
    expect(accepted.json()).toMatchObject({ jobId: "job-1", status: "completed", currentStepIndex: 4 });
    expect(accepted.json()).not.toHaveProperty("reportAccessToken");
    expect(accepted.json()).not.toHaveProperty("report_access_token_hash");
    expect(JSON.stringify(accepted.json())).not.toContain(ACCESS_TOKEN);
    await app.close();
  });
  it("does not disclose whether a different job exists to a token holder", async () => {
    const app = buildServer(store as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/other-job", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
