#!/usr/bin/env bash
set -euo pipefail

DB="${WORKER_FENCING_DATABASE_URL:?WORKER_FENCING_DATABASE_URL is required}"
if [[ "$DB" != "postgresql://postgres:postgres@localhost:5432/reson8_test" ]]; then
  echo "Refusing report-persistence E2E test: database URL is not the disposable CI reson8_test service" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="reson8-report-persistence-postgrest-$GITHUB_RUN_ID"
JWT_SECRET="$(openssl rand -hex 32)"
POSTGREST_STARTED=0

cleanup() {
  set +e
  if [[ "$POSTGREST_STARTED" == "1" ]]; then
    docker stop "$CONTAINER" >/dev/null 2>&1
    docker rm "$CONTAINER" >/dev/null 2>&1
  fi
  psql "$DB" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
drop trigger if exists ci_abort_report_insert_for_case_b on public.audit_reports;
drop function if exists public.ci_abort_report_insert_for_case_b();
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
revoke anon, authenticated, service_role from authenticator;
drop role if exists authenticator;
SQL
}
trap cleanup EXIT

psql "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/.github/scripts/report-persistence-e2e-setup.sql"

docker run --detach --rm --name "$CONTAINER" --network host \
  -e PGRST_DB_URI="postgres://authenticator:reson8-ci-authenticator-only@127.0.0.1:5432/reson8_test" \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e PGRST_SERVER_PORT=3000 \
  postgrest/postgrest:v12.2.12 >/dev/null
POSTGREST_STARTED=1

READY=0
for _ in $(seq 1 40); do
  if curl --silent --show-error --fail http://127.0.0.1:3000/ >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" != "1" ]]; then
  docker logs "$CONTAINER" || true
  echo "Disposable PostgREST did not become ready" >&2
  exit 1
fi

export POSTGREST_URL="http://127.0.0.1:3000"
export CI_REPORT_PERSISTENCE_JWT_SECRET="$JWT_SECRET"
export SUPABASE_URL="http://127.0.0.1:54321"
export WORKER_FENCING_DATABASE_URL="$DB"

npx vitest run tests/report-persistence-e2e.test.ts
