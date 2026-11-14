import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const TOKEN = "d".repeat(64);
const PDF = Buffer.from("%PDF-1.7\\n");

function store() {
  return {
    createJobDependencies: () => { throw new Error("not used"); },
    verifyAuditAccessToken: async (jobId: string, token: string) => jobId === "job-a" && token === TOKEN,
    getAuditReport: async (_jobId: string, tier: string) => ({
      bytes: PDF,
      contentType: "application/pdf",
      filename: "report-" + tier + ".pdf",
    }),
  } as any;
}

describe("job-scoped full-report capability experience", () => {
  it("allows the matching job capability to unlock a full report while payment enforcement is disabled", async () => {
    delete process.env.PAYMENTS_ENABLED;
    delete process.env.RESON8_OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-a/reports/full",
      headers: { "x-reson8-report-token": TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    await app.close();
  });

  it("rejects a capability token belonging to another job", async () => {
    delete process.env.PAYMENTS_ENABLED;
    const app = buildServer(store());
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-b/reports/full",
      headers: { "x-reson8-report-token": TOKEN },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("keeps full-report access fail-closed when payment enforcement is enabled", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    const app = buildServer(store());
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/job-a/reports/full",
      headers: { "x-reson8-report-token": TOKEN },
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toBe("PAYMENT_REQUIRED");
    await app.close();
    delete process.env.PAYMENTS_ENABLED;
  });

  it("provides a masked, revealable, copyable in-page capability and manual unlock input", async () => {
    const [html, script] = await Promise.all([
      readFile(new URL("../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ]);
    expect(html).toContain('id="accessTokenDisplay"');
    expect(html).toContain('id="revealAccessTokenButton"');
    expect(html).toContain('id="copyAccessTokenButton"');
    expect(html).toContain('id="fullReportAccessKey"');
    expect(html).toContain('id="unlockFullReportButton"');
    expect(script).toContain("navigator.clipboard");
    expect(script).toContain('const accessToken=pastedKey||reportAccessToken;');
    expect(script).toContain('downloadReport("full",accessToken)');
    expect(script).not.toContain("triggerCredentialDownload(");
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
  });
});
