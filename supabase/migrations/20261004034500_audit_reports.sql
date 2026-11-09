create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  tier text not null check (tier in ('sample','full')),
  version integer not null default 1,
  access_status text not null check (access_status in ('available','locked','unlocked')),
  storage_path text not null,
  sha256 text not null,
  content_type text not null default 'application/pdf',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_job_id, tier, version)
);

create index if not exists audit_reports_job_idx
  on public.audit_reports(audit_job_id, tier, version desc);

alter table public.audit_reports enable row level security;

drop policy if exists audit_reports_service_only on public.audit_reports;

create policy audit_reports_service_only
  on public.audit_reports
  for all
  using (false)
  with check (false);

insert into storage.buckets (id, name, public)
values ('audit-reports', 'audit-reports', false)
on conflict (id) do update set public = false;

comment on table public.audit_reports is
  'Private generated A&R report artifacts. Full reports remain locked until a verified commercial entitlement is granted.';
