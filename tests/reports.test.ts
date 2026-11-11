import { PDFDocument } from "@cantoo/pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { fullAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";

const OPERATOR_KEY = "test-operator-key-that-is-at-least-32-bytes-long";
const originalPayments = process.env.PAYMENTS_ENABLED;
const originalOperatorKey = process.env.RESON8_OPERATOR_KEY;

afterEach(() => {
  if (originalPayments === undefined) delete process.env.PAYMENTS_ENABLED;
  else process.env.PAYMENTS_ENABLED = originalPayments;
  if (originalOperatorKey === undefined) delete process.env.RESON8_OPERATOR_KEY;
  else process.env.RESON8_OPERATOR_KEY = originalOperatorKey;
});

describe("full audit report response format", () => {
  it("compiles a stored JSON payload and returns an inline PDF for a completed audit", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const store = {
      createJobDependencies: () => { throw new Error("not used"); },
      getAuditStatus: async () => ({ jobId: fullAudioFixture.auditId, status: "completed", currentStepIndex: 5, full: { available: true, version: 1 } }),
      getAuditReport: async () => ({
        bytes: Buffer.from(JSON.stringify(fullAudioFixture)),
        contentType: "application/json",
        filename: "full.json",
      }),
    } as any;
    const app = buildServer(store);

    try {
      const status = await app.inject({ method: "GET", url: `/v1/audits/${fullAudioFixture.auditId}` });
      expect(status.json().status).toBe("completed");
      const response = await app.inject({
        method: "GET",
        url: `/v1/audits/${fullAudioFixture.auditId}/reports/full`,
        headers: { "x-reson8-operator-key": OPERATOR_KEY },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(response.headers["content-disposition"]).toBe('inline; filename="audit-report.pdf"');
      expect(response.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      await expect(PDFDocument.load(response.rawPayload)).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("compiles the retained full-report input when the stored PDF object is missing", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const store = {
      createJobDependencies: () => { throw new Error("not used"); },
      getAuditReport: async () => { throw new Error("Unable to download audit report: not found"); },
      getAuditReportPayload: async () => fullAudioFixture,
    } as any;
    const app = buildServer(store);

    try {
      const response = await app.inject({
        method: "GET",
        url: `/v1/audits/${fullAudioFixture.auditId}/reports/full`,
        headers: { "x-reson8-operator-key": OPERATOR_KEY },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(response.headers["content-disposition"]).toBe('inline; filename="audit-report.pdf"');
      expect(response.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      await expect(PDFDocument.load(response.rawPayload)).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });
});
