#!/usr/bin/env bash
set -euo pipefail

: "${WORKER_FENCING_DATABASE_URL:?WORKER_FENCING_DATABASE_URL is required}"
DB="$WORKER_FENCING_DATABASE_URL"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMA="$ROOT/.github/scripts/worker-fencing-schema.sql"

psql "$DB" -v ON_ERROR_STOP=1 -f "$SCHEMA"
echo "Replaying exact historical migrations and the current repository migration chain"
for MIGRATION in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$MIGRATION")"
  psql "$DB" -v ON_ERROR_STOP=1 -f "$MIGRATION"
done

JOB_MAIN="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
JOB_FAIL="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
JOB_STALE="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
JOB_EXPIRED="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
JOB_ROLLBACK="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
JOB_RACE="ffffffff-ffff-4fff-8fff-ffffffffffff"

seed_job() {
  local id="$1" source_type="${2:-master}"
  if [[ "$source_type" == "dsp_link" ]]; then
    psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_jobs(id,source_type,catalog_url,status) values ('$id','dsp_link','https://open.spotify.com/track/test','queued')"
  else
    psql "$DB" -v ON_ERROR_STOP=1 -c "insert into public.audit_jobs(id,source_type,source_audio_path,mime_type,status) values ('$id','master','ci/fixture.wav','audio/wav','queued')"
  fi
}
claim_job() {
  local id="$1" worker="$2"
  psql "$DB" -At -v ON_ERROR_STOP=1 -c "select claim_token from public.claim_next_audit_job('$worker',180) where id='$id'"
}
rpc() {
  local id="$1" token="$2" operation="$3" payload="$4"
  psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.persist_fenced_audit_step('$id','$token','$operation','$payload'::jsonb)"
}
assert_sql() {
  local expected="$1" sql="$2" actual
  actual="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "$sql")"
  test "$actual" = "$expected" || { echo "FAIL: expected [$expected], got [$actual]"; exit 1; }
}

echo "Baseline: production-derived application tables, constraints, indexes, and RLS policies"
assert_sql "10" "select count(*) from pg_tables where schemaname='public'"
assert_sql "t" "select relrowsecurity from pg_class where oid='public.audit_jobs'::regclass"
assert_sql "t" "select relrowsecurity from pg_class where oid='public.recognition_results'::regclass"
assert_sql "t" "select relrowsecurity from pg_class where oid='public.audit_reports_legacy'::regclass"
assert_sql "t" "select relrowsecurity from pg_class where oid='public.audit_assessments'::regclass"
assert_sql "f:t" "select has_function_privilege('anon','public.persist_fenced_audit_step(uuid,uuid,text,jsonb)','execute')::text || ':' || has_function_privilege('service_role','public.persist_fenced_audit_step(uuid,uuid,text,jsonb)','execute')::text"

echo "Regression 1/8: concurrent claims grant the sole queued job exactly once"
seed_job "$JOB_MAIN"
psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-worker-a',180)" > /tmp/worker-claim-a.txt &
PID_A=$!
psql "$DB" -At -v ON_ERROR_STOP=1 -c "select id from public.claim_next_audit_job('ci-worker-b',180)" > /tmp/worker-claim-b.txt &
PID_B=$!
wait "$PID_A"; wait "$PID_B"
CLAIM_COUNT="$(cat /tmp/worker-claim-a.txt /tmp/worker-claim-b.txt | grep -c . || true)"
test "$CLAIM_COUNT" = "1"
TOKEN_MAIN="$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "select claim_token from public.audit_jobs where id='$JOB_MAIN'")"
echo "PASS: one claim only"

echo "Regression 2/8: processing_started and catalog_metadata persist with events"
rpc "$JOB_MAIN" "$TOKEN_MAIN" processing_started '{}'
rpc "$JOB_MAIN" "$TOKEN_MAIN" catalog_metadata '{"platform":"spotify","catalogId":"track-test","raw":{"title":"Fixture Track"},"evidenceStatus":"recognized"}'
assert_sql "spotify:track-test" "select catalog_platform || ':' || catalog_id from public.audit_jobs where id='$JOB_MAIN'"
assert_sql "2" "select count(*) from public.audit_events where audit_job_id='$JOB_MAIN'"

echo "Regression 3/8: recognition upsert, evidence reconciliation, and Sonic DNA persistence"
rpc "$JOB_MAIN" "$TOKEN_MAIN" recognition '{"matched":true,"artist":"Fixture Artist","title":"Fixture Track","releaseDate":"2025-01-02","isrc":"NGABC2500001","rawResponse":{"provider":"audd"}}'
rpc "$JOB_MAIN" "$TOKEN_MAIN" recognition '{"matched":true,"artist":"Fixture Artist Updated","title":"Fixture Track","releaseDate":"2025-01-02","isrc":"NGABC2500001","rawResponse":{"provider":"audd","revision":2}}'
assert_sql "1:Fixture Artist Updated" "select count(*)::text || ':' || max(artist) from public.recognition_results where audit_job_id='$JOB_MAIN'"
rpc "$JOB_MAIN" "$TOKEN_MAIN" evidence '{"canonicalArtist":"Fixture Artist","canonicalTitle":"Fixture Track","releaseDate":"2025-01-02","isrc":"NGABC2500001","evidenceStatus":"verified","reconciliationStatus":"reconciled","sources":[{"provider":"audd"}]}'
assert_sql "verified" "select evidence_status from public.reconciled_tracks where audit_job_id='$JOB_MAIN'"
rpc "$JOB_MAIN" "$TOKEN_MAIN" sonic_dna '{"durationSeconds":"182.4","sampleRate":"44100","channels":"2","bpm":"126","key":"C","mode":"major","loudnessLufs":"-9.2","rmsEnergy":"0.2","dynamicRangeDb":"7.1","spectralCentroidHz":"2400","spectralBandwidthHz":"1800","spectralRolloffHz":"9000","zeroCrossingRate":"0.04","moodTags":["energetic"],"genreContext":["afrobeats"],"rawFeatures":{"fixture":true}}'
assert_sql "1:126:182.4" "select count(*)::text || ':' || max(bpm)::text || ':' || (select duration_seconds::text from public.audit_jobs where id='$JOB_MAIN') from public.sonic_dna where audit_job_id='$JOB_MAIN'"
echo "PASS: all three persistence paths and their upsert/constraint contracts"

echo "Regression 4/8: assessment and versioned report persistence"
rpc "$JOB_MAIN" "$TOKEN_MAIN" assessment '{"model":"fixture-model","promptVersion":"test-v1","assessment":{"verdict":"promising","score":82}}'
assert_sql "promising" "select assessment->>'verdict' from public.audit_assessments where audit_job_id='$JOB_MAIN'"
rpc "$JOB_MAIN" "$TOKEN_MAIN" report '{"tier":"sample","storagePath":"ci/sample.pdf","sha256":"sample-hash"}'
rpc "$JOB_MAIN" "$TOKEN_MAIN" report '{"tier":"sample","storagePath":"ci/sample-v2.pdf","sha256":"sample-hash-v2"}'
assert_sql "1,2" "select string_agg(version::text,',' order by version) from public.audit_reports where audit_job_id='$JOB_MAIN' and tier='sample'"
echo "PASS: assessment and serialized report version allocation"

echo "Regression 5/8: lease renewal and completion clear all fencing fields"
psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.renew_audit_job_lease('$JOB_MAIN','$TOKEN_MAIN',180)"
rpc "$JOB_MAIN" "$TOKEN_MAIN" complete '{}'
assert_sql "completed:true:true:true" "select status || ':' || (claim_token is null)::text || ':' || (lease_expires_at is null)::text || ':' || (worker_id is null)::text from public.audit_jobs where id='$JOB_MAIN'"
assert_sql "audit_completed" "select event_type from public.audit_events where audit_job_id='$JOB_MAIN' order by created_at desc limit 1"

echo "Regression 6/8: fail operation atomically records failure and clears lease"
seed_job "$JOB_FAIL"
TOKEN_FAIL="$(claim_job "$JOB_FAIL" ci-fail-worker)"
rpc "$JOB_FAIL" "$TOKEN_FAIL" fail '{"message":"fixture failure"}'
assert_sql "failed:AUDIT_PROCESSING_FAILED:true:true:true" "select status || ':' || error_code || ':' || (claim_token is null)::text || ':' || (lease_expires_at is null)::text || ':' || (worker_id is null)::text from public.audit_jobs where id='$JOB_FAIL'"

echo "Regression 7/8: stale tokens, expired leases, and invalid payloads are rejected without partial writes"
seed_job "$JOB_STALE"
TOKEN_STALE="$(claim_job "$JOB_STALE" ci-stale-worker)"
if rpc "$JOB_STALE" "99999999-9999-4999-8999-999999999999" processing_started '{}' >/tmp/worker-stale-token.txt 2>&1; then
  echo "FAIL: mismatched token unexpectedly succeeded"; exit 1
fi
grep -q "AUDIT_LEASE_LOST" /tmp/worker-stale-token.txt
seed_job "$JOB_EXPIRED"
TOKEN_EXPIRED="$(claim_job "$JOB_EXPIRED" ci-expired-worker)"
psql "$DB" -v ON_ERROR_STOP=1 -c "update public.audit_jobs set lease_expires_at=clock_timestamp()-interval '5 seconds' where id='$JOB_EXPIRED'"
if rpc "$JOB_EXPIRED" "$TOKEN_EXPIRED" processing_started '{}' >/tmp/worker-expired-lease.txt 2>&1; then
  echo "FAIL: expired lease unexpectedly succeeded"; exit 1
fi
grep -q "AUDIT_LEASE_LOST" /tmp/worker-expired-lease.txt
seed_job "$JOB_ROLLBACK"
TOKEN_ROLLBACK="$(claim_job "$JOB_ROLLBACK" ci-rollback-worker)"
BEFORE_EVENTS="$(psql "$DB" -At -c "select count(*) from public.audit_events where audit_job_id='$JOB_ROLLBACK'")"
if rpc "$JOB_ROLLBACK" "$TOKEN_ROLLBACK" recognition '{"matched":true,"releaseDate":"not-a-date"}' >/tmp/worker-rollback.txt 2>&1; then
  echo "FAIL: invalid date unexpectedly succeeded"; exit 1
fi
AFTER_EVENTS="$(psql "$DB" -At -c "select count(*) from public.audit_events where audit_job_id='$JOB_ROLLBACK'")"
test "$BEFORE_EVENTS" = "$AFTER_EVENTS"
assert_sql "0" "select count(*) from public.recognition_results where audit_job_id='$JOB_ROLLBACK'"
echo "PASS: stale/expired fencing and transaction rollback"

echo "Regression 8/8: heartbeat/completion race leaves terminal job unfenced"
seed_job "$JOB_RACE"
TOKEN_RACE="$(claim_job "$JOB_RACE" ci-race-worker)"
psql "$DB" -v ON_ERROR_STOP=1 -c "set role service_role; select public.renew_audit_job_lease('$JOB_RACE','$TOKEN_RACE',180)" >/tmp/worker-heartbeat.txt 2>&1 &
HEARTBEAT_PID=$!
rpc "$JOB_RACE" "$TOKEN_RACE" complete '{}' >/tmp/worker-complete.txt 2>&1 &
COMPLETE_PID=$!
wait "$COMPLETE_PID"
if ! wait "$HEARTBEAT_PID"; then grep -q "AUDIT_LEASE_LOST" /tmp/worker-heartbeat.txt; fi
assert_sql "completed:true:true:true" "select status || ':' || (claim_token is null)::text || ':' || (lease_expires_at is null)::text || ':' || (worker_id is null)::text from public.audit_jobs where id='$JOB_RACE'"

echo "All full-schema PostgreSQL 17 worker-fencing regressions passed."
