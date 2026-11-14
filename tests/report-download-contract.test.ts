import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const originalKey = process.env.RESON8_OPERATOR_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RESON8_OPERATOR_KEY;
  else process.env.RESON8_OPERATOR_KEY = originalKey;
});

const store = () => ({
  createJobDependencies: () => { throw new Error("not used"); },
  getAuditStatus: async () => ({ jobId: "job-1", status: "completed" as const, currentStepIndex: 5, full: { available: true, version: 1 } }),
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
