import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, operatorAuthorized, paymentsEnabled } from "../src/server.js";
const PDF = Buffer.from("%PDF-1.7\n");
const OPERATOR_KEY = "test-operator-key-that-is-at-least-32-bytes-long";
const ACCESS_TOKEN = "b".repeat(64);
const originalPayments = process.env.PAYMENTS_ENABLED;
const originalOperatorKey = process.env.RESON8_OPERATOR_KEY;
function store() {
  return {
    createJobDependencies: () => { throw new Error("not used"); },
    verifyAuditAccessToken: async (jobId: string, token: string) => jobId === "id" && token === ACCESS_TOKEN,
    getAuditReport: async (_id: string, tier: string) => ({ bytes: PDF, contentType: "application/pdf", filename: "report-" + tier + ".pdf" }),
  } as any;
}
afterEach(() => {
  if (originalPayments === undefined) delete process.env.PAYMENTS_ENABLED; else process.env.PAYMENTS_ENABLED = originalPayments;
  if (originalOperatorKey === undefined) delete process.env.RESON8_OPERATOR_KEY; else process.env.RESON8_OPERATOR_KEY = originalOperatorKey;
});
describe("capability-protected anonymous report access", () => {
  it("denies status and report access without the per-job capability even if an operator key is configured", async () => {
    delete process.env.PAYMENTS_ENABLED;
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    expect(paymentsEnabled()).toBe(false);
    const app = buildServer(store());
    const status = await app.inject({ method: "GET", url: "/v1/audits/id" });
    const sample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample", headers: { "x-reson8-operator-key": OPERATOR_KEY } });
    const full = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-operator-key": OPERATOR_KEY } });
    expect(status.statusCode).toBe(404);
    expect(sample.statusCode).toBe(404);
    expect(full.statusCode).toBe(404);
    await app.close();
  });
  it("allows anonymous status and sample-report access with the matching per-job token", async () => {
    delete process.env.PAYMENTS_ENABLED;
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer({ ...store(), getAuditStatus: async () => ({ jobId: "id", status: "completed", currentStepIndex: 5, full: { available: true, version: 1 } }) } as any);
    const headers = { "x-reson8-report-token": ACCESS_TOKEN };
    const status = await app.inject({ method: "GET", url: "/v1/audits/id", headers });
    const sample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample", headers });
    expect(status.statusCode).toBe(200);
    expect(sample.statusCode).toBe(200);
    await app.close();
  });
  it("does not allow one job's capability to authorize a different job", async () => {
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/another-job/reports/sample", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
  it("allows the matching job capability to unlock full reports while payments are disabled", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store());
    const tokenOnly = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(tokenOnly.statusCode).toBe(200);
    await app.close();
  });
  it("keeps full reports payment-gated when payments are enabled and no operator is authenticated", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toBe("PAYMENT_REQUIRED");
    await app.close();
  });
  it("does not let operator credentials bypass enabled payment enforcement", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-operator-key": OPERATOR_KEY, "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toBe("PAYMENT_REQUIRED");
    await app.close();
  });
  it("allows anonymous sample retrieval while payment enforcement is enabled", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
  it("keeps stored-payload fallback behind capability, payment, and operator authorization", async () => {
    delete process.env.PAYMENTS_ENABLED;
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const getAuditReportPayload = vi.fn(async () => PDF);
    const app = buildServer({
      ...store(),
      getAuditReport: async () => { throw new Error("stored PDF unavailable"); },
      getAuditReportPayload,
    } as any);
    const deniedSample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample" });
    const deniedFull = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-operator-key": OPERATOR_KEY } });
    expect(deniedSample.statusCode).toBe(404);
    expect(deniedFull.statusCode).toBe(404);
    expect(getAuditReportPayload).not.toHaveBeenCalled();
    const headers = { "x-reson8-report-token": ACCESS_TOKEN };
    const sample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample", headers });
    const fullWithoutOperator = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers });
    expect(sample.statusCode).toBe(200);
    expect(fullWithoutOperator.statusCode).toBe(200);
    expect(getAuditReportPayload).toHaveBeenCalledTimes(2);
    process.env.PAYMENTS_ENABLED = "true";
    const paymentGatedFull = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { ...headers, "x-reson8-operator-key": OPERATOR_KEY } });
    expect(paymentGatedFull.statusCode).toBe(402);
    expect(getAuditReportPayload).toHaveBeenCalledTimes(2);
    await app.close();
  });
  it("fails closed for absent or weak configured operator secrets", () => {
    expect(operatorAuthorized(OPERATOR_KEY, undefined)).toBe(false);
    expect(operatorAuthorized(OPERATOR_KEY, "short-secret")).toBe(false);
    expect(operatorAuthorized("wrong-key-that-is-at-least-32-bytes-long", OPERATOR_KEY)).toBe(false);
    expect(operatorAuthorized(OPERATOR_KEY, OPERATOR_KEY)).toBe(true);
  });
  it("treats malformed payment flag values as disabled without opening full report access", async () => {
    process.env.PAYMENTS_ENABLED = "enabled-ish";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    expect(paymentsEnabled()).toBe(false);
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
