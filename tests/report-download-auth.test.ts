import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const previousKey = process.env.RESON8_OPERATOR_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.RESON8_OPERATOR_KEY;
  else process.env.RESON8_OPERATOR_KEY = previousKey;
});

function testStore() {
  return {
    createJobDependencies: () => { throw new Error("not used"); },
    getAuditStatus: async () => ({ jobId: "job-1", status: "completed" as const, currentStepIndex: 5, full: { available: true, version: 1 } }),
    getAuditReport: async () => ({
      bytes: new TextEncoder().encode("%PDF-1.4\n% test PDF"),
      contentType: "application/pdf",
      filename: "report.pdf",
    }),
  } as any;
}

describe("report download response contract", () => {
  it("returns an authorization JSON response when the operator key is absent", async () => {
    process.env.RESON8_OPERATOR_KEY = "a".repeat(40);
    const app = buildServer(testStore());
    const response = await app.inject({ method: "GET", url: "/v1/audits/job-1/reports/sample" });
    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "OPERATOR_AUTH_REQUIRED" });
    await app.close();
  });

  it("returns PDF bytes with an explicit PDF content type when the operator key is valid", async () => {
    process.env.RESON8_OPERATOR_KEY = "a".repeat(40);
    const app = buildServer(testStore());
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-1/reports/sample",
      headers: { "x-reson8-operator-key": "a".repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.startsWith("%PDF-")).toBe(true);
    await app.close();
  });
});
