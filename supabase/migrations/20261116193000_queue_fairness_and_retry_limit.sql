-- Prevent an older expired lease from starving newer queued submissions.
-- An expired job gets at most three claims per explicit retry generation. A
-- subsequent retry request starts a fresh three-claim budget.
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

  -- Fail only expired jobs whose current retry generation has already been
  -- claimed three times. Never mutate a live lease or a queued submission.
  with exhausted as (
    select job.id
    from public.audit_jobs as job
    where job.status = 'processing'
      and job.lease_expires_at < clock_timestamp()
      and (
        select count(*)
        from public.audit_events as claim_event
        where claim_event.audit_job_id = job.id
          and claim_event.event_type = 'processing_claimed'
          and claim_event.created_at > coalesce(
            (
              select max(retry_event.created_at)
              from public.audit_events as retry_event
              where retry_event.audit_job_id = job.id
                and retry_event.event_type = 'audit_retry_requested'
            ),
            '-infinity'::timestamptz
          )
      ) >= 3
    for update of job skip locked
  ), failed as (
    update public.audit_jobs as job
    set status = 'failed',
        completed_at = clock_timestamp(),
        error_code = 'WORKER_LEASE_RETRIES_EXHAUSTED',
        error_message = 'The worker lease expired after three claims in this retry cycle.',
        claim_token = null,
        worker_id = null,
        lease_expires_at = null
    from exhausted
    where job.id = exhausted.id
    returning job.id
  )
  insert into public.audit_events (audit_job_id, event_type, status, message, payload)
  select
    failed.id,
    'audit_failed',
    'failed',
    'Worker lease retry limit exceeded',
    jsonb_build_object('reason', 'worker_lease_retry_limit', 'maxClaimsPerRetry', 3)
  from failed;

  select * into v_job
  from public.audit_jobs
  where (
      status = 'queued'
      or (status = 'processing' and lease_expires_at < clock_timestamp())
    )
    and (source_type not in ('master', 'combined') or source_audio_path is not null)
    and (
      source_type not in ('dsp_link', 'combined')
      or catalog_url is not null
      or case
        when jsonb_typeof(catalog_metadata->'submittedLinks') = 'array' then exists (
          select 1
          from jsonb_array_elements(catalog_metadata->'submittedLinks') as submitted_link(value)
          where jsonb_typeof(submitted_link.value) = 'string'
            and length(trim(submitted_link.value #>> '{}')) > 0
        )
        else false
      end
      or exists (
        select 1
        from public.audit_events as submitted_event
        where submitted_event.audit_job_id = public.audit_jobs.id
          and submitted_event.event_type = 'catalog_links_submitted'
          and case
            when jsonb_typeof(submitted_event.payload->'submittedLinks') = 'array' then exists (
              select 1
              from jsonb_array_elements(submitted_event.payload->'submittedLinks') as submitted_link(value)
              where jsonb_typeof(submitted_link.value) = 'string'
                and length(trim(submitted_link.value #>> '{}')) > 0
            )
            else false
          end
      )
    )
  order by case when status = 'queued' then 0 else 1 end, created_at asc
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
