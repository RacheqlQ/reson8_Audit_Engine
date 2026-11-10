#!/usr/bin/env bash
set -euo pipefail

: "${WORKER_FENCING_DATABASE_URL:?WORKER_FENCING_DATABASE_URL is required}"
DB="$WORKER_FENCING_DATABASE_URL"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261110000000_worker_lease_fencing.sql"

echo "Preparing isolated PostgreSQL schema for worker-fencing regression tests"
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.audit_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  source_audio_path text,
  mime_type text,
  source_type text not null default 'master',
  catalog_url text,
  status text not null default 'queued',
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  catalog_platform text,
  catalog_id text,
  catalog_metadata jsonb not null default '{}'::jsonb
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  event_type text not null,
  status text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

grant usage on schema public to service_role;
grant select, insert, update on public.audit_jobs, public.audit_events to service_role;
SQL

echo "Applying the PR migration to the disposable PostgreSQL service"
psql "$DB" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.audit_jobs (id, source_type, source_audio_path, mime_type, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'master', 'ci/fixture.wav', 'audio/wav', 'queued');
SQL

echo "Regression 1/4: two concurrent claim RPCs can claim the sole queued job only once"
psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-worker-a', 180)" > /tmp/worker-claim-a.txt &
PID_A=$!
psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-worker-b', 180)" > /tmp/worker-claim-b.txt &
PID_B=$!
wait "$PID_A"
wait "$PID_B"
CLAIM_COUNT="$(cat /tmp/worker-claim-a.txt /tmp/worker-claim-b.txt | grep -c . || true)"
test "$CLAIM_COUNT" = "1"
echo "PASS: exactly one worker received the queued job"

echo "Regression 2/4: mismatched stale-worker token is rejected by the SQL RPC"
CURRENT_TOKEN="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select claim_token from public.audit_jobs where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")"
if psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'processing_started', '{}'::jsonb)" >/tmp/worker-stale-token.txt 2>&1; then
  echo "FAIL: mismatched token unexpectedly succeeded"
  exit 1
fi
grep -q "AUDIT_LEASE_LOST" /tmp/worker-stale-token.txt
echo "PASS: stale token rejected with AUDIT_LEASE_LOST"

echo "Regression 3/4: expired matching lease is rejected by the SQL RPC"
psql "$DB" -v ON_ERROR_STOP=1 -c "update public.audit_jobs set lease_expires_at = clock_timestamp() - interval '5 seconds' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
if psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '$CURRENT_TOKEN', 'processing_started', '{}'::jsonb)" >/tmp/worker-expired-lease.txt 2>&1; then
  echo "FAIL: expired lease unexpectedly succeeded"
  exit 1
fi
grep -q "AUDIT_LEASE_LOST" /tmp/worker-expired-lease.txt
echo "PASS: expired lease rejected with AUDIT_LEASE_LOST"

echo "Regression 4/4: concurrent heartbeat and terminal completion leave a completed, unfenced job"
psql "$DB" -v ON_ERROR_STOP=1 -c "update public.audit_jobs set lease_expires_at = clock_timestamp() + interval '2 minutes' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.renew_audit_job_lease('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '$CURRENT_TOKEN', 180)" >/tmp/worker-heartbeat.txt 2>&1 &
HEARTBEAT_PID=$!
psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '$CURRENT_TOKEN', 'complete', '{}'::jsonb)" >/tmp/worker-complete.txt 2>&1 &
COMPLETE_PID=$!
wait "$COMPLETE_PID"
if ! wait "$HEARTBEAT_PID"; then
  grep -q "AUDIT_LEASE_LOST" /tmp/worker-heartbeat.txt
fi
FINAL_STATE="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select status || ':' || (claim_token is null)::text || ':' || (lease_expires_at is null)::text || ':' || (worker_id is null)::text from public.audit_jobs where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")"
test "$FINAL_STATE" = "completed:true:true:true"
echo "PASS: terminal completion wins; no live lease remains"

echo "All isolated PostgreSQL worker-fencing regressions passed."
