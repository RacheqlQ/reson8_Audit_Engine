import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const originalKey = process.env.RESON8_OPERATOR_KEY;
const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RESON8_OPERATOR_KEY;
  else process.env.RESON8_OPERATOR_KEY = originalKey;
  if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
  else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
});

const store = () => ({
  createJobDependencies: () => { throw new Error("not used"); },
  getAuditStatus: async () => ({ jobId: "job-1", status: "completed" as const, currentStepIndex: 5, full: { available: true, version: 1 } }),
  verifySampleReportAccess: async (_jobId: string, token: string) => token === "valid-sample-token",
  getAuditReport: async () => ({
    bytes: new TextEncoder().encode("%PDF-1.4\n% valid test fixture"),
    contentType: "application/pdf",
    filename: "report.pdf",
  }),
});

describe("report download contract", () => {
  it("returns structured authorization JSON rather than pretending an unauthorized response is a PDF", async () => {
    process.env.RESON8_OPERATOR_KEY = "operator-secret-value-with-more-than-32-bytes";
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample" });
    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "OPERATOR_AUTH_REQUIRED" });
    await app.close();
  });

  it("allows the submitting job's sample token without exposing operator credentials", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store() as any);
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/sample",
      headers: { "x-reson8-report-token": "valid-sample-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });

  it("rejects an invalid job-scoped sample token", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store() as any);
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/sample",
      headers: { "x-reson8-report-token": "0".repeat(64) },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "OPERATOR_AUTH_REQUIRED" });
    await app.close();
  });

  it("does not accept a sample capability as authorization for the full report", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    process.env.PAYMENTS_ENABLED = "false";
    const app = buildServer(store() as any);
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/full",
      headers: { "x-reson8-report-token": "valid-sample-token" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "OPERATOR_AUTH_REQUIRED" });
    await app.close();
  });

  it("requires verified payment when payment enforcement is enabled and no operator key is supplied", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    process.env.PAYMENTS_ENABLED = "true";
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/full" });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({ error: "PAYMENT_REQUIRED" });
    await app.close();
  });

  it("returns a real full PDF to an authorized operator", async () => {
    const key = "operator-secret-value-with-more-than-32-bytes";
    process.env.RESON8_OPERATOR_KEY = key;
    const app = buildServer(store() as any);
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/full",
      headers: { "x-reson8-operator-key": key },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });

  it("returns a real PDF content type and signature to an authorized operator", async () => {
    const key = "operator-secret-value-with-more-than-32-bytes";
    process.env.RESON8_OPERATOR_KEY = key;
    const app = buildServer(store() as any);
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/sample",
      headers: { "x-reson8-operator-key": key },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });
});
