import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
const ACCESS_TOKEN = "a".repeat(64);
const OPERATOR_KEY = "operator-secret-value-with-more-than-32-bytes";
const originalKey = process.env.RESON8_OPERATOR_KEY;
const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RESON8_OPERATOR_KEY; else process.env.RESON8_OPERATOR_KEY = originalKey;
  if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED; else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
});
const store = () => ({
  createJobDependencies: () => { throw new Error("not used"); },
  getAuditStatus: async () => ({ jobId: "job-1", status: "completed" as const, currentStepIndex: 5, full: { available: true, version: 1 } }),
  verifyAuditAccessToken: async (jobId: string, token: string) => jobId === "job-1" && token === ACCESS_TOKEN,
  getAuditReport: async () => ({ bytes: new TextEncoder().encode("%PDF-1.4\\n% valid test fixture"), contentType: "application/pdf", filename: "report.pdf" }),
});
describe("report download contract", () => {
  it("serves the report download browser module as JavaScript", async () => {
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/report-download.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["content-type"]).toContain("charset=utf-8");
    expect(response.body).toContain("export async function readPdfResponse");
    expect(response.body).toContain("export function triggerPdfDownload");
    await app.close();
  });
  it.each([
    ["/audit-polling.js", "export function createAuditPoller"],
    ["/credential-download.js", "export function credentialFilename"],
  ])("serves the %s browser dependency as JavaScript", async (path, exportedSymbol) => {
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: path });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["content-type"]).toContain("charset=utf-8");
    expect(response.body).toContain(exportedSymbol);
    await app.close();
  });
  it("does not reveal report existence without a matching capability token", async () => {
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "REPORT_NOT_FOUND" });
    await app.close();
  });
  it("allows the submitting audit's sample token without operator credentials", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });
  it("rejects an invalid job-scoped sample token", async () => {
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample", headers: { "x-reson8-report-token": "0".repeat(64) } });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "REPORT_NOT_FOUND" });
    await app.close();
  });
  it("does not allow a sample capability to bypass the disabled-payment full-report restriction", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    process.env.PAYMENTS_ENABLED = "false";
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/full", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "OPERATOR_AUTH_REQUIRED" });
    await app.close();
  });
  it("requires verified payment when payment enforcement is enabled and no operator key is supplied", async () => {
    delete process.env.RESON8_OPERATOR_KEY;
    process.env.PAYMENTS_ENABLED = "true";
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/full", headers: { "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({ error: "PAYMENT_REQUIRED" });
    await app.close();
  });
  it("allows operator full-report access only with both operator credentials and the job token", async () => {
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    process.env.PAYMENTS_ENABLED = "false";
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/full", headers: { "x-reson8-operator-key": OPERATOR_KEY, "x-reson8-report-token": ACCESS_TOKEN } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });
  it("requires the job token even for an operator sample download", async () => {
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store() as any);
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample", headers: { "x-reson8-operator-key": OPERATOR_KEY } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
