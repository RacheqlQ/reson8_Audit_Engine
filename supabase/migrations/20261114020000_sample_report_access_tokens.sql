-- Store only a hash of the random per-job sample report capability.
-- The raw token is returned once at intake and held by the submitting browser in memory.
alter table public.audit_jobs
  add column if not exists report_access_token_hash text;

alter table public.audit_jobs
  drop constraint if exists audit_jobs_report_access_token_hash_check;

alter table public.audit_jobs
  add constraint audit_jobs_report_access_token_hash_check
  check (report_access_token_hash is null or report_access_token_hash ~ '^[a-f0-9]{64}$');
