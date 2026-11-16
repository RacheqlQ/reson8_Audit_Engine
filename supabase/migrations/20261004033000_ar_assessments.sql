create table if not exists public.audit_assessments (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'completed'
    check (status in ('pending','completed','failed')),
  assessment jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_job_id)
);

create index if not exists audit_assessments_job_idx
  on public.audit_assessments(audit_job_id);

alter table public.audit_assessments enable row level security;

drop policy if exists audit_assessments_no_public_access on public.audit_assessments;
drop policy if exists audit_assessments_service_only on public.audit_assessments;
create policy audit_assessments_no_public_access
  on public.audit_assessments
  for all
  using (false)
  with check (false);

comment on table public.audit_assessments is
  'Private server-generated A&R assessments. Service-role access only until commercial report delivery is implemented.';
