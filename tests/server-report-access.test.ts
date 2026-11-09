import { afterEach, describe, expect, it } from "vitest";
import { buildServer, paymentsEnabled } from "../src/server.js";
const PDF = Buffer.from("%PDF-1.7\n");
const original = process.env.PAYMENTS_ENABLED;
function store() { return { createJobDependencies: () => { throw new Error("not used"); }, getAuditReport: async (_id: string, tier: string) => ({ bytes: PDF, contentType: "application/pdf", filename: "report-" + tier + ".pdf" }) } as any; }
afterEach(() => { if (original === undefined) delete process.env.PAYMENTS_ENABLED; else process.env.PAYMENTS_ENABLED = original; });
describe("report payment flag", () => {
 it("defaults to disabled and permits anonymous sample and full downloads when missing", async () => { delete process.env.PAYMENTS_ENABLED; expect(paymentsEnabled()).toBe(false); const app=buildServer(store()); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/sample"})).statusCode).toBe(200); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/full"})).statusCode).toBe(200); await app.close(); });
 it("permits anonymous sample and full downloads when explicitly false", async () => { process.env.PAYMENTS_ENABLED="false"; expect(paymentsEnabled()).toBe(false); const app=buildServer(store()); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/full"})).statusCode).toBe(200); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/sample"})).statusCode).toBe(200); await app.close(); });
 it("denies unpaid full access but keeps sample free when explicitly true", async () => { process.env.PAYMENTS_ENABLED="true"; expect(paymentsEnabled()).toBe(true); const app=buildServer(store()); const full=await app.inject({method:"GET",url:"/v1/audits/id/reports/full"}); expect(full.statusCode).toBe(402); expect(full.json().error).toBe("PAYMENT_REQUIRED"); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/sample"})).statusCode).toBe(200); await app.close(); });
 it("treats malformed values as disabled without crashing", async () => { process.env.PAYMENTS_ENABLED="enabled-ish"; expect(paymentsEnabled()).toBe(false); const app=buildServer(store()); expect((await app.inject({method:"GET",url:"/v1/audits/id/reports/full"})).statusCode).toBe(200); await app.close(); });
});
