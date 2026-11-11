#!/usr/bin/env bash
set -euo pipefail

: "${WORKER_FENCING_DATABASE_URL:?WORKER_FENCING_DATABASE_URL is required}"
DB="$WORKER_FENCING_DATABASE_URL"

# This runs only against the disposable PostgreSQL service in GitHub Actions.
# Never point WORKER_FENCING_DATABASE_URL at a hosted or production database.
JOB_ID="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select gen_random_uuid()")"
OLD_WORKER="ci-recovery-before"
NEW_WORKER="ci-recovery-after"

psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_jobs(id,source_type,source_audio_path,mime_type,status) values ('$JOB_ID','master','ci/recovery-fixture.wav','audio/wav','queued')"

OLD_TOKEN="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select claim_token from public.claim_next_audit_job('$OLD_WORKER',180) where id='$JOB_ID')"
test -n "$OLD_TOKEN"

# Simulate a worker disappearing after claim. This mutation is confined to the
# ephemeral CI Postgres database; the production database is never contacted.
psql "$DB" -v ON_ERROR_STOP=1 -c "update public.audit_jobs set lease_expires_at=clock_timestamp()-interval '5 seconds' where id='$JOB_ID'"

NEW_TOKEN="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select claim_token from public.claim_next_audit_job('$NEW_WORKER',180) where id='$JOB_ID')"
test -n "$NEW_TOKEN"
test "$NEW_TOKEN" != "$OLD_TOKEN"

assert_sql() {
  local expected="$1" sql="$2" actual
  actual="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "$sql")"
  test "$actual" = "$expected" || {
    echo "FAIL: expected [$expected], got [$actual]"
    exit 1
  }
}

assert_sql "processing:$NEW_WORKER:$NEW_TOKEN" "select status || ':' || worker_id || ':' || claim_token::text from public.audit_jobs where id='$JOB_ID'"

if psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('$JOB_ID','$OLD_TOKEN','processing_started','{}'::jsonb)" >/tmp/worker-recovery-stale-token.txt 2>&1; then
  echo "FAIL: previous worker token unexpectedly remained valid after recovery"
  exit 1
fi
grep -q "AUDIT_LEASE_LOST" /tmp/worker-recovery-stale-token.txt

psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('$JOB_ID','$NEW_TOKEN','processing_started','{}'::jsonb)"
psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('$JOB_ID','$NEW_TOKEN','complete','{}'::jsonb)"
assert_sql "completed:true:true:true" "select status || ':' || (claim_token is null)::text || ':' || (lease_expires_at is null)::text || ':' || (worker_id is null)::text from public.audit_jobs where id='$JOB_ID'"

echo "PASS: expired processing lease was reclaimed with a new token; old worker was fenced; recovered job completed."
