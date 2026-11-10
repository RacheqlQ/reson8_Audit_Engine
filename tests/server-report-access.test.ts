import { afterEach, describe, expect, it } from "vitest";
import { buildServer, operatorAuthorized, paymentsEnabled } from "../src/server.js";

const PDF = Buffer.from("%PDF-1.7\n");
const OPERATOR_KEY = "test-operator-key-that-is-at-least-32-bytes-long";
const originalPayments = process.env.PAYMENTS_ENABLED;
const originalOperatorKey = process.env.RESON8_OPERATOR_KEY;

function store() {
  return {
    createJobDependencies: () => { throw new Error("not used"); },
    getAuditReport: async (_id: string, tier: string) => ({
      bytes: PDF,
      contentType: "application/pdf",
      filename: "report-" + tier + ".pdf",
    }),
  } as any;
}

afterEach(() => {
  if (originalPayments === undefined) delete process.env.PAYMENTS_ENABLED;
  else process.env.PAYMENTS_ENABLED = originalPayments;
  if (originalOperatorKey === undefined) delete process.env.RESON8_OPERATOR_KEY;
  else process.env.RESON8_OPERATOR_KEY = originalOperatorKey;
});

describe("operator report access control", () => {
  it("defaults payments to disabled and denies report retrieval without operator credentials", async () => {
    delete process.env.PAYMENTS_ENABLED;
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    expect(paymentsEnabled()).toBe(false);
    const app = buildServer(store());
    const sample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample" });
    const full = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full" });
    expect(sample.statusCode).toBe(403);
    expect(sample.json().error).toBe("OPERATOR_AUTH_REQUIRED");
    expect(full.statusCode).toBe(403);
    expect(full.json().error).toBe("OPERATOR_AUTH_REQUIRED");
    await app.close();
  });

  it("rejects missing and incorrect operator credentials when payments are disabled", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const missing = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full" });
    const incorrect = await app.inject({
      method: "GET",
      url: "/v1/audits/id/reports/full",
      headers: { "x-reson8-operator-key": "incorrect-operator-key-that-is-32-bytes" },
    });
    expect(missing.statusCode).toBe(403);
    expect(incorrect.statusCode).toBe(403);
    await app.close();
  });

  it("allows the operator to retrieve sample and full reports when payments are disabled", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const headers = { "x-reson8-operator-key": OPERATOR_KEY };
    const sample = await app.inject({ method: "GET", url: "/v1/audits/id/reports/sample", headers });
    const full = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full", headers });
    expect(sample.statusCode).toBe(200);
    expect(full.statusCode).toBe(200);
    await app.close();
  });

  it("keeps full reports payment-gated when payments are enabled and no operator is authenticated", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full" });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toBe("PAYMENT_REQUIRED");
    await app.close();
  });

  it("allows the operator to retrieve full reports even when payments are enabled", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    const app = buildServer(store());
    const response = await app.inject({
      method: "GET",
      url: "/v1/audits/id/reports/full",
      headers: { "x-reson8-operator-key": OPERATOR_KEY },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("fails closed for absent or weak configured secrets and compares valid keys", () => {
    expect(operatorAuthorized(OPERATOR_KEY, undefined)).toBe(false);
    expect(operatorAuthorized(OPERATOR_KEY, "short-secret")).toBe(false);
    expect(operatorAuthorized("wrong-key-that-is-at-least-32-bytes-long", OPERATOR_KEY)).toBe(false);
    expect(operatorAuthorized(OPERATOR_KEY, OPERATOR_KEY)).toBe(true);
  });

  it("treats malformed payment flag values as disabled without opening report access", async () => {
    process.env.PAYMENTS_ENABLED = "enabled-ish";
    process.env.RESON8_OPERATOR_KEY = OPERATOR_KEY;
    expect(paymentsEnabled()).toBe(false);
    const app = buildServer(store());
    const response = await app.inject({ method: "GET", url: "/v1/audits/id/reports/full" });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
