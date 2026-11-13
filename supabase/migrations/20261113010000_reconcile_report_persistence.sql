-- Resolve uncertain report-persistence RPC outcomes without racing an in-flight commit.
-- The fenced persistence RPC locks the same audit_jobs row before inserting audit_reports.
-- Taking that lock here waits for the original transaction to commit or roll back.
create or replace function public.reconcile_audit_report_reference(
  p_job_id uuid,
  p_tier text,
  p_storage_path text,
  p_sha256 text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
begin
  if p_tier not in ('sample', 'full') then
    raise exception 'Invalid audit report tier' using errcode = '22023';
  end if;

  select id into v_job_id
  from public.audit_jobs
  where id = p_job_id
  for update;

  if not found then
    return false;
  end if;

  return exists (
    select 1
    from public.audit_reports
    where audit_job_id = p_job_id
      and tier = p_tier
      and storage_path = p_storage_path
      and sha256 = p_sha256
      and content_type = 'application/pdf'
  );
end;
$$;

revoke all on function public.reconcile_audit_report_reference(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_audit_report_reference(uuid, text, text, text) to service_role;
