import { createHmac, createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSupabaseAuditStore } from "../src/integrations/supabase-audit-store.js";

const fixtures = {
  a: { job: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" },
  b: { job: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" },
  c: { job: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", token: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2" },
};
const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nCI synthetic report bytes\n%%EOF\n"));
const digest = createHash("sha256").update(pdf).digest("hex");
const secret = process.env.CI_REPORT_PERSISTENCE_JWT_SECRET;
const postgrest = process.env.POSTGREST_URL;

function jwtServiceRole(): string {
  if (!secret || !postgrest) throw new Error("CI-only PostgREST settings are required");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role: "service_role", iss: "supabase", iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

type Scenario = { loseReportResponse: boolean; failReconciliation: boolean };
const objects = new Map<string, { bytes: Buffer; contentType: string }>();
let cleanupRequests = 0;
let lostReportResponses = 0;
let reconciliationRequests = 0;
let scenario: Scenario = { loseReportResponse: false, failReconciliation: false };
let server: ReturnType<typeof createServer>;
let baseUrl = "";
let serviceKey = "";

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

beforeAll(async () => {
  serviceKey = jwtServiceRole();
  server = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const path = req.url ?? "/";
      if (req.headers.apikey !== serviceKey || req.headers.authorization !== `Bearer ${serviceKey}`) {
        send(res, 401, JSON.stringify({ message: "CI emulator rejected non-test credentials" }));
        return;
      }

      if (path.startsWith("/storage/v1/object/audit-reports/") && req.method === "POST") {
        const objectPath = decodeURIComponent(path.slice("/storage/v1/object/audit-reports/".length).split("?")[0]);
        if (objects.has(objectPath)) {
          send(res, 409, JSON.stringify({ message: "Object already exists" }));
          return;
        }
        objects.set(objectPath, {
          bytes: Buffer.from(body),
          contentType: String(req.headers["content-type"] ?? ""),
        });
        send(res, 200, JSON.stringify({ Key: `audit-reports/${objectPath}` }));
        return;
      }

      if (path === "/storage/v1/object/audit-reports" && req.method === "DELETE") {
        cleanupRequests += 1;
        const parsed = JSON.parse(body.toString("utf8")) as { prefixes?: string[] };
        for (const prefix of parsed.prefixes ?? []) objects.delete(prefix);
        send(res, 200, JSON.stringify({ message: "deleted" }));
        return;
      }

      if (path.startsWith("/rest/v1/")) {
        const isRpc = path.startsWith("/rest/v1/rpc/");
        const rpc = isRpc ? path.slice("/rest/v1/rpc/".length).split("?")[0] : "";
        if (rpc === "reconcile_audit_report_reference") {
          reconciliationRequests += 1;
          if (scenario.failReconciliation) {
            send(res, 503, JSON.stringify({ message: "CI injected reconciliation outage" }));
            return;
          }
        }
        const parsed = isRpc && body.length ? JSON.parse(body.toString("utf8")) as { p_operation?: string } : {};
        const shouldLose = isRpc && rpc === "persist_fenced_audit_step"
          && parsed.p_operation === "report" && scenario.loseReportResponse;
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (value !== undefined && !["host", "connection", "content-length"].includes(name.toLowerCase())) {
            headers.set(name, Array.isArray(value) ? value.join(",") : value);
          }
        }
        const upstream = await fetch(new URL(path, postgrest), {
          method: req.method,
          headers,
          body: body.length ? body : undefined,
        });
        const responseBody = Buffer.from(await upstream.arrayBuffer());
        if (shouldLose && upstream.ok) {
          scenario.loseReportResponse = false;
          lostReportResponses += 1;
          res.destroy();
          return;
        }
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
        });
        res.end(responseBody);
        return;
      }

      send(res, 404, JSON.stringify({ message: "Unsupported CI emulator route" }));
    } catch (error) {
      if (!res.headersSent) send(res, 500, JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
      else res.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  objects.clear();
});

function store() {
  return createSupabaseAuditStore(baseUrl, serviceKey);
}

async function reportRow(jobId: string) {
  const { data, error } = await store().admin.from("audit_reports")
    .select("audit_job_id,tier,storage_path,sha256,content_type")
    .eq("audit_job_id", jobId)
    .eq("tier", "sample")
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe.sequential("real saveReport persistence recovery through PostgREST and Storage HTTP", () => {
  it("preserves the uploaded PDF when the successful fenced commit response is lost", async () => {
    const beforeCleanup = cleanupRequests;
    const beforeLost = lostReportResponses;
    const beforeReconcile = reconciliationRequests;
    scenario = { loseReportResponse: true, failReconciliation: false };
    await store().saveReport(fixtures.a.job, fixtures.a.token, "sample", pdf);

    const row = await reportRow(fixtures.a.job);
    const storagePath = `${fixtures.a.job}/${fixtures.a.token}/sample.pdf`;
    expect(lostReportResponses).toBe(beforeLost + 1);
    expect(reconciliationRequests).toBe(beforeReconcile + 1);
    expect(cleanupRequests).toBe(beforeCleanup);
    expect(row).toMatchObject({
      audit_job_id: fixtures.a.job, tier: "sample", storage_path: storagePath,
      sha256: digest, content_type: "application/pdf",
    });
    expect(objects.get(storagePath)?.bytes.equals(Buffer.from(pdf))).toBe(true);
    expect(objects.get(storagePath)?.contentType).toBe("application/pdf");
  });

  it("cleans the uploaded object after the report transaction is rolled back", async () => {
    const beforeCleanup = cleanupRequests;
    const storagePath = `${fixtures.b.job}/${fixtures.b.token}/sample.pdf`;
    await expect(store().saveReport(fixtures.b.job, fixtures.b.token, "sample", pdf))
      .rejects.toThrow("CI_INJECTED_REPORT_INSERT_ROLLBACK");
    expect(await reportRow(fixtures.b.job)).toBeNull();
    expect(objects.has(storagePath)).toBe(false);
    expect(cleanupRequests).toBe(beforeCleanup + 1);
  });

  it("preserves the object and reports an unknown outcome when reconciliation fails", async () => {
    const beforeCleanup = cleanupRequests;
    const beforeLost = lostReportResponses;
    const beforeReconcile = reconciliationRequests;
    const storagePath = `${fixtures.c.job}/${fixtures.c.token}/sample.pdf`;
    scenario = { loseReportResponse: true, failReconciliation: true };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(store().saveReport(fixtures.c.job, fixtures.c.token, "sample", pdf))
        .rejects.toMatchObject({
          name: "AggregateError",
          message: expect.stringContaining("outcome is unknown"),
        });
      expect(lostReportResponses).toBe(beforeLost + 1);
      expect(reconciliationRequests).toBe(beforeReconcile + 1);
      expect(cleanupRequests).toBe(beforeCleanup);
      expect(objects.get(storagePath)?.bytes.equals(Buffer.from(pdf))).toBe(true);
      expect(objects.get(storagePath)?.contentType).toBe("application/pdf");
      expect(await reportRow(fixtures.c.job)).toMatchObject({
        audit_job_id: fixtures.c.job, tier: "sample", storage_path: storagePath,
        sha256: digest, content_type: "application/pdf",
      });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("report_artifact_persistence_outcome_unknown"));
    } finally {
      log.mockRestore();
      scenario = { loseReportResponse: false, failReconciliation: false };
    }
  });
});
