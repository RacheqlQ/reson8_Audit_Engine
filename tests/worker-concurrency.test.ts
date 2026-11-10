import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// This suite deliberately requires a disposable Supabase project and a pre-seeded
// audit_jobs row. It must never point at the production Reson8 Audit Engine project.
const databaseUrl = process.env.WORKER_FENCING_TEST_SUPABASE_URL;
const serviceRoleKey = process.env.WORKER_FENCING_TEST_SERVICE_ROLE_KEY;
const fixtureJobId = process.env.WORKER_FENCING_TEST_JOB_ID;
const enabled = Boolean(databaseUrl && serviceRoleKey && fixtureJobId);

describe.skipIf(!enabled)("worker lease fencing (Supabase integration)", () => {
  let admin: SupabaseClient | null = null;
  const db = () => {
    if (!admin) throw new Error("Supabase integration client was not initialized");
    return admin;
  };
  let claimToken: string;

  beforeAll(async () => {
    if (!databaseUrl || !serviceRoleKey || !fixtureJobId) return;
    const projectRef = new URL(databaseUrl).hostname.split(".")[0];
    if (projectRef === "gznwamoxuxzaayjaxvlo") {
      throw new Error("Worker fencing integration tests refuse to run against production");
    }
    admin = createClient(databaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.from("audit_jobs").select("id,status").eq("id", fixtureJobId).single();
    if (error || !data) throw new Error(`WORKER_FENCING_TEST_JOB_ID must identify a pre-seeded disposable job: ${error?.message ?? "not found"}`);
    if (data.status !== "queued") throw new Error("Disposable worker fixture must be queued before the test suite starts");
  });

  beforeEach(async () => {
    claimToken = randomUUID();
    const { error } = await db().from("audit_jobs").update({
      status: "processing",
      claim_token: claimToken,
      worker_id: "worker-concurrency-test",
      lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
    }).eq("id", fixtureJobId);
    if (error) throw new Error(`Unable to prepare disposable worker fixture: ${error.message}`);
  });

  afterAll(async () => {
    if (!admin || !fixtureJobId) return;
    await db().from("audit_jobs").update({
      status: "queued",
      claim_token: null,
      worker_id: null,
      lease_expires_at: null,
    }).eq("id", fixtureJobId);
  });

  it("atomically grants a queued fixture to at most one of two simultaneous workers", async () => {
    const { error: resetError } = await db().from("audit_jobs").update({
      status: "queued", claim_token: null, worker_id: null, lease_expires_at: null,
    }).eq("id", fixtureJobId);
    if (resetError) throw new Error(`Unable to queue disposable fixture: ${resetError.message}`);

    const claims = await Promise.all([
      db().rpc("claim_next_audit_job", { p_worker_id: `concurrency-a:${randomUUID()}`, p_lease_seconds: 180 }),
      db().rpc("claim_next_audit_job", { p_worker_id: `concurrency-b:${randomUUID()}`, p_lease_seconds: 180 }),
    ]);
    for (const claim of claims) {
      if (claim.error) throw new Error(`Atomic claim RPC failed: ${claim.error.message}`);
    }
    const claimedIds = claims.flatMap((claim) => {
      const rows = Array.isArray(claim.data) ? claim.data : claim.data ? [claim.data] : [];
      return rows.map((row) => row.id);
    }).filter((id) => id === fixtureJobId);
    expect(claimedIds).toHaveLength(1);
  });

  it("rejects a zombie worker with a mismatched claim token at the database boundary", async () => {
    const { error } = await db().rpc("persist_fenced_audit_step", {
      p_job_id: fixtureJobId,
      p_claim_token: randomUUID(),
      p_operation: "processing_started",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("AUDIT_LEASE_LOST");
  });

  it("rejects a worker whose matching token has an expired lease", async () => {
    const { error: expireError } = await db().from("audit_jobs").update({
      lease_expires_at: new Date(Date.now() - 5_000).toISOString(),
    }).eq("id", fixtureJobId);
    if (expireError) throw new Error(`Unable to expire disposable fixture lease: ${expireError.message}`);

    const { error } = await db().rpc("persist_fenced_audit_step", {
      p_job_id: fixtureJobId,
      p_claim_token: claimToken,
      p_operation: "processing_started",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("AUDIT_LEASE_LOST");
  });
});
