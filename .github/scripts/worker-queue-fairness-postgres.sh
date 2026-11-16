#!/usr/bin/env bash
set -euo pipefail

: "${WORKER_FENCING_DATABASE_URL:?WORKER_FENCING_DATABASE_URL is required}"
DB="$WORKER_FENCING_DATABASE_URL"

seed_master() {
  local id="$1" status="$2" created="$3"
  psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_jobs(id,source_type,source_audio_path,mime_type,status,created_at,claim_token,worker_id,lease_expires_at,started_at) values ('$id','master','ci/queue-fixture.wav','audio/wav','$status','$created',case when '$status'='processing' then gen_random_uuid() else null end,case when '$status'='processing' then 'ci-stale-worker' else null end,case when '$status'='processing' then clock_timestamp()-interval '5 seconds' else null end,case when '$status'='processing' then clock_timestamp()-interval '10 minutes' else null end)"
}

assert_sql() {
  local expected="$1" sql="$2" actual
  actual="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "$sql")"
  test "$actual" = "$expected" || { echo "FAIL: expected [$expected], got [$actual]"; exit 1; }
}

STALE_JOB="11111111-1111-4111-8111-111111111111"
QUEUED_JOB="22222222-2222-4222-8222-222222222222"
EXHAUSTED_JOB="33333333-3333-4333-8333-333333333333"
NEXT_QUEUED_JOB="44444444-4444-4444-8444-444444444444"

echo "Regression 1: a queued submission must be claimed before an older expired lease"
seed_master "$STALE_JOB" processing "2026-01-01T00:00:00Z"
seed_master "$QUEUED_JOB" queued "2026-01-02T00:00:00Z"
psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_events(audit_job_id,event_type,status,payload) values ('$STALE_JOB','processing_claimed','processing','{}'::jsonb)"
CLAIMED="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-fairness-worker',180)")"
test "$CLAIMED" = "$QUEUED_JOB"
echo "PASS: fresh queued work is not starved by an older expired job"

echo "Regression 2: an expired job exceeding three claims after its last explicit retry is failed and fenced"
seed_master "$EXHAUSTED_JOB" processing "2025-12-01T00:00:00Z"
seed_master "$NEXT_QUEUED_JOB" queued "2025-12-02T00:00:00Z"
psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_events(audit_job_id,event_type,status,payload) values
  ('$EXHAUSTED_JOB','audit_retry_requested','queued','{}'::jsonb),
  ('$EXHAUSTED_JOB','processing_claimed','processing','{}'::jsonb),
  ('$EXHAUSTED_JOB','processing_claimed','processing','{}'::jsonb),
  ('$EXHAUSTED_JOB','processing_claimed','processing','{}'::jsonb)"
CLAIMED="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-retry-limit-worker',180)")"
test "$CLAIMED" = "$NEXT_QUEUED_JOB"
assert_sql "failed:WORKER_LEASE_RETRIES_EXHAUSTED:true:true:true" "select status || ':' || error_code || ':' || (claim_token is null)::text || ':' || (worker_id is null)::text || ':' || (lease_expires_at is null)::text from public.audit_jobs where id='$EXHAUSTED_JOB'"
assert_sql "audit_failed:worker_lease_retry_limit" "select event_type || ':' || (payload->>'reason') from public.audit_events where audit_job_id='$EXHAUSTED_JOB' order by created_at desc limit 1"
echo "PASS: exhausted stale job is terminally fenced; newer queued work is claimed"
