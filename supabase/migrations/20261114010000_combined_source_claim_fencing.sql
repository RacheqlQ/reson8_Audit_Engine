-- Combined source jobs must not be claimed until BOTH inputs are finalized.
-- The master upload is written after the job row is inserted, so this mirrors the
-- existing master-only fencing and adds the equivalent DSP requirement.
create or replace function public.claim_next_audit_job(
  p_worker_id text,
  p_lease_seconds integer default 180
)
returns setof public.audit_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.audit_jobs%rowtype;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease_seconds must be between 30 and 3600' using errcode = '22023';
  end if;

  select * into v_job
  from public.audit_jobs
  where (
      status = 'queued'
      or (status = 'processing' and lease_expires_at < clock_timestamp())
    )
    and (source_type not in ('master', 'combined') or source_audio_path is not null)
    and (source_type not in ('dsp_link', 'combined') or catalog_url is not null)
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.audit_jobs
  set status = 'processing',
      claim_token = gen_random_uuid(),
      worker_id = p_worker_id,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, clock_timestamp())
  where id = v_job.id
  returning * into v_job;

  insert into public.audit_events (audit_job_id, event_type, status, message, payload)
  values (
    v_job.id, 'processing_claimed', 'processing', null,
    jsonb_build_object('workerId', p_worker_id, 'leaseExpiresAt', v_job.lease_expires_at)
  );

  return next v_job;
end;
$$;
