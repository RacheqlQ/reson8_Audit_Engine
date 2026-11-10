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
  let admin: SupabaseClient;
  let originalStatus: string;
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
    originalStatus = data.status;
  });

  beforeEach(async () => {
    claimToken = randomUUID();
    const { error } = await admin.from("audit_jobs").update({
      status: "processing",
      claim_token: claimToken,
      worker_id: "worker-concurrency-test",
      lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
    }).eq("id", fixtureJobId);
    if (error) throw new Error(`Unable to prepare disposable worker fixture: ${error.message}`);
  });

  afterAll(async () => {
    if (!admin || !fixtureJobId) return;
    await admin.from("audit_jobs").update({
      status: originalStatus ?? "queued",
      claim_token: null,
      worker_id: null,
      lease_expires_at: null,
    }).eq("id", fixtureJobId);
  });

  it("rejects a zombie worker with a mismatched claim token at the database boundary", async () => {
    const { error } = await admin.rpc("persist_fenced_audit_step", {
      p_job_id: fixtureJobId,
      p_claim_token: randomUUID(),
      p_operation: "processing_started",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("AUDIT_LEASE_LOST");
  });

  it("rejects a worker whose matching token has an expired lease", async () => {
    const { error: expireError } = await admin.from("audit_jobs").update({
      lease_expires_at: new Date(Date.now() - 5_000).toISOString(),
    }).eq("id", fixtureJobId);
    if (expireError) throw new Error(`Unable to expire disposable fixture lease: ${expireError.message}`);

    const { error } = await admin.rpc("persist_fenced_audit_step", {
      p_job_id: fixtureJobId,
      p_claim_token: claimToken,
      p_operation: "processing_started",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("AUDIT_LEASE_LOST");
  });
});
