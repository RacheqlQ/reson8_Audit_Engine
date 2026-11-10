-- MANUAL RECOVERY DRAFT — not a migration. Do not run during deployment.
-- Preconditions:
--   1. The worker-fencing migration 20261110000000 has been applied separately.
--   2. All old worker processes are stopped and drained; no worker is processing
--      these rows outside the database.
--   3. Review the preview below and add only explicitly approved job UUIDs.
--
-- This preserves audit_jobs rows, timestamps, child records, reports, and events.
-- It never deletes job/result data. The approval list is empty by default and the
-- transaction ends with ROLLBACK; change that to COMMIT only after reviewing the
-- returned rows in a controlled recovery window.

begin;

do $preflight$
declare
  v_required_columns text[] := array[
    'claim_token', 'lease_expires_at', 'worker_id'
  ];
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_jobs'
      and column_name = any (v_required_columns)
  ) <> cardinality(v_required_columns) then
    raise exception 'Worker-fencing columns are absent; apply migration 20261110000000 before recovery';
  end if;
end;
$preflight$;

-- Preview only: inconsistent partial claims are labeled for manual review and
-- are never eligible for the automated requeue below.
select
  id,
  status,
  source_type,
  created_at,
  started_at,
  completed_at,
  claim_token,
  worker_id,
  case
    when claim_token is null and worker_id is null and completed_at is null
      then 'unfenced_legacy_candidate'
    else 'manual_review_inconsistent_fence'
  end as recovery_class
from public.audit_jobs
where status = 'processing'
  and lease_expires_at is null
order by started_at nulls first, created_at, id;

create temporary table approved_legacy_jobs (
  id uuid primary key
) on commit drop;

-- Add only UUIDs reviewed in the preview after confirming workers are stopped.
-- Example:
-- insert into approved_legacy_jobs (id) values
--   ('00000000-0000-4000-8000-000000000000'::uuid);

do $validate$
declare
  v_bad_id uuid;
begin
  -- Lock approved rows so their status/fence fields cannot change between the
  -- eligibility check and the update.
  perform j.id
  from public.audit_jobs as j
  join approved_legacy_jobs as a on a.id = j.id
  for update of j;

  select a.id
  into v_bad_id
  from approved_legacy_jobs as a
  left join public.audit_jobs as j on j.id = a.id
  where j.id is null
     or j.status is distinct from 'processing'
     or j.lease_expires_at is not null
     or j.claim_token is not null
     or j.worker_id is not null
     or j.completed_at is not null
  limit 1;

  if v_bad_id is not null then
    raise exception 'An approved job is missing or no longer an unfenced processing row; aborting';
  end if;
end;
$validate$;

with requeued as (
  update public.audit_jobs as j
  set status = 'queued'
  from approved_legacy_jobs as a
  where j.id = a.id
    and j.status = 'processing'
    and j.lease_expires_at is null
    and j.claim_token is null
    and j.worker_id is null
    and j.completed_at is null
  returning j.id, j.started_at
)
insert into public.audit_events (
  audit_job_id, event_type, status, message, payload
)
select
  id,
  'legacy_lease_recovery_queued',
  'queued',
  'Operator-approved recovery of a processing job without a lease',
  jsonb_build_object(
    'reason', 'legacy_processing_without_lease',
    'preservedStartedAt', started_at
  )
from requeued;

-- Inspect the proposed post-recovery state before changing the final ROLLBACK.
select
  j.id,
  j.status,
  j.started_at,
  j.completed_at,
  j.claim_token,
  j.lease_expires_at,
  j.worker_id
from public.audit_jobs as j
join approved_legacy_jobs as a on a.id = j.id
order by j.id;

rollback;
