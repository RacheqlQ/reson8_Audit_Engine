alter table public.audit_jobs
  alter column original_filename drop not null,
  alter column mime_type drop not null,
  alter column size_bytes drop not null,
  alter column source_audio_path drop not null;

alter table public.audit_jobs
  add column if not exists source_type text not null default 'master',
  add column if not exists catalog_url text,
  add column if not exists catalog_platform text,
  add column if not exists catalog_id text,
  add column if not exists catalog_metadata jsonb not null default '{}'::jsonb;

alter table public.audit_jobs drop constraint if exists audit_jobs_source_type_check;
alter table public.audit_jobs add constraint audit_jobs_source_type_check
  check (source_type in ('master','dsp_link','combined'));

alter table public.audit_jobs drop constraint if exists audit_jobs_size_bytes_check;
alter table public.audit_jobs add constraint audit_jobs_size_bytes_check
  check (size_bytes is null or size_bytes > 0);

create index if not exists audit_jobs_queue_idx on public.audit_jobs(status, created_at) where status = 'queued';
create index if not exists audit_jobs_catalog_platform_idx on public.audit_jobs(catalog_platform);
