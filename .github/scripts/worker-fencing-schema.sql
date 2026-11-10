-- Canonical test fixture reconstructed from read-only production catalog metadata.
-- Snapshot date: 2026-11-10. No production rows, secrets, or auth identities are included.
-- This is a test baseline, not a claim to reproduce the unrecovered historical migration SQL.

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then
  alter role service_role bypassrls;
end $$;

create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  original_filename text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  duration_seconds numeric,
  sha256 text,
  source_audio_path text,
  recognition_sample_path text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  source_type text not null default 'master' check (source_type in ('master','dsp_link','combined')),
  catalog_url text,
  catalog_platform text,
  catalog_id text,
  catalog_metadata jsonb not null default '{}'::jsonb
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  event_type text not null,
  status text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.recognition_results (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  provider text not null check (provider = 'audd'),
  matched boolean not null default false,
  artist text,
  title text,
  album text,
  release_date date,
  label text,
  isrc text,
  timecode text,
  song_link text,
  confidence numeric,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (audit_job_id, provider)
);

create table public.reconciled_tracks (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  canonical_artist text,
  canonical_title text,
  album text,
  release_date date,
  label text,
  isrc text,
  upc text,
  spotify_id text,
  apple_music_id text,
  musicbrainz_id text,
  evidence_status text not null default 'unresolved' check (evidence_status in ('unresolved','partial','verified')),
  confidence numeric,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sonic_dna (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  analysis_version text not null,
  duration_seconds numeric,
  sample_rate integer,
  channels integer,
  bpm numeric,
  key text,
  mode text,
  loudness_lufs numeric,
  rms_energy numeric,
  dynamic_range_db numeric,
  spectral_centroid_hz numeric,
  spectral_bandwidth_hz numeric,
  spectral_rolloff_hz numeric,
  zero_crossing_rate numeric,
  rhythm_features jsonb not null default '{}'::jsonb,
  harmonic_features jsonb not null default '{}'::jsonb,
  vocal_features jsonb not null default '{}'::jsonb,
  mood_tags jsonb not null default '[]'::jsonb,
  genre_context jsonb not null default '[]'::jsonb,
  raw_features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_assessments (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'completed' check (status in ('pending','completed','failed')),
  assessment jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.aar_assessments (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  model_provider text not null default 'groq',
  model text not null,
  prompt_version text not null,
  overall_score numeric,
  verdict text,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  market_fit jsonb not null default '{}'::jsonb,
  audience_fit jsonb not null default '{}'::jsonb,
  positioning jsonb not null default '{}'::jsonb,
  release_strategy jsonb not null default '{}'::jsonb,
  comparable_artists jsonb not null default '[]'::jsonb,
  recommended_next_steps jsonb not null default '[]'::jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_reports (
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

create index audit_events_job_created_idx on public.audit_events(audit_job_id, created_at desc);
create index audit_jobs_catalog_platform_idx on public.audit_jobs(catalog_platform);
create index audit_jobs_owner_created_idx on public.audit_jobs(owner_id, created_at desc);
create unique index audit_jobs_owner_sha256_uidx on public.audit_jobs(owner_id, sha256) where sha256 is not null;
create index audit_jobs_queue_idx on public.audit_jobs(status, created_at) where status = 'queued';
create index audit_jobs_status_idx on public.audit_jobs(status);
create index audit_assessments_job_idx on public.audit_assessments(audit_job_id);
create index audit_reports_job_idx on public.audit_reports(audit_job_id, tier, version desc);

alter table public.profiles enable row level security;
alter table public.audit_jobs enable row level security;
alter table public.audit_events enable row level security;
alter table public.recognition_results enable row level security;
alter table public.reconciled_tracks enable row level security;
alter table public.sonic_dna enable row level security;
alter table public.audit_assessments enable row level security;
alter table public.audit_reports enable row level security;
alter table public.aar_assessments enable row level security;

create policy "Profiles owner select" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Profiles owner insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Profiles owner update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Profiles owner delete" on public.profiles for delete to authenticated using (auth.uid() = id);

create policy "Audit jobs owner select" on public.audit_jobs for select to authenticated using (auth.uid() = owner_id);
create policy "Audit jobs owner insert" on public.audit_jobs for insert to authenticated with check (auth.uid() = owner_id);
create policy "Audit jobs owner update" on public.audit_jobs for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Audit jobs owner delete" on public.audit_jobs for delete to authenticated using (auth.uid() = owner_id);

create policy "Events owner select" on public.audit_events for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_events.audit_job_id and j.owner_id = auth.uid()));
create policy "Events owner insert" on public.audit_events for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_events.audit_job_id and j.owner_id = auth.uid()));
create policy "Events owner update" on public.audit_events for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_events.audit_job_id and j.owner_id = auth.uid())) with check (exists (select 1 from public.audit_jobs j where j.id = audit_events.audit_job_id and j.owner_id = auth.uid()));
create policy "Events owner delete" on public.audit_events for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_events.audit_job_id and j.owner_id = auth.uid()));

create policy "Recognition owner select" on public.recognition_results for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = recognition_results.audit_job_id and j.owner_id = auth.uid()));
create policy "Recognition owner insert" on public.recognition_results for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = recognition_results.audit_job_id and j.owner_id = auth.uid()));
create policy "Recognition owner update" on public.recognition_results for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = recognition_results.audit_job_id and j.owner_id = auth.uid())) with check (exists (select 1 from public.audit_jobs j where j.id = recognition_results.audit_job_id and j.owner_id = auth.uid()));
create policy "Recognition owner delete" on public.recognition_results for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = recognition_results.audit_job_id and j.owner_id = auth.uid()));

create policy "Reconciled owner select" on public.reconciled_tracks for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = reconciled_tracks.audit_job_id and j.owner_id = auth.uid()));
create policy "Reconciled owner insert" on public.reconciled_tracks for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = reconciled_tracks.audit_job_id and j.owner_id = auth.uid()));
create policy "Reconciled owner update" on public.reconciled_tracks for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = reconciled_tracks.audit_job_id and j.owner_id = auth.uid())) with check (exists (select 1 from public.audit_jobs j where j.id = reconciled_tracks.audit_job_id and j.owner_id = auth.uid()));
create policy "Reconciled owner delete" on public.reconciled_tracks for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = reconciled_tracks.audit_job_id and j.owner_id = auth.uid()));

create policy "Sonic DNA owner select" on public.sonic_dna for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = sonic_dna.audit_job_id and j.owner_id = auth.uid()));
create policy "Sonic DNA owner insert" on public.sonic_dna for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = sonic_dna.audit_job_id and j.owner_id = auth.uid()));
create policy "Sonic DNA owner update" on public.sonic_dna for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = sonic_dna.audit_job_id and j.owner_id = auth.uid())) with check (exists (select 1 from public.audit_jobs j where j.id = sonic_dna.audit_job_id and j.owner_id = auth.uid()));
create policy "Sonic DNA owner delete" on public.sonic_dna for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = sonic_dna.audit_job_id and j.owner_id = auth.uid()));

create policy audit_assessments_service_only on public.audit_assessments for all using (false) with check (false);
create policy audit_reports_service_only on public.audit_reports for all using (false) with check (false);
create policy "AAR owner select" on public.aar_assessments for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = aar_assessments.audit_job_id and j.owner_id = auth.uid()));
create policy "AAR owner insert" on public.aar_assessments for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = aar_assessments.audit_job_id and j.owner_id = auth.uid()));
create policy "AAR owner update" on public.aar_assessments for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = aar_assessments.audit_job_id and j.owner_id = auth.uid())) with check (exists (select 1 from public.audit_jobs j where j.id = aar_assessments.audit_job_id and j.owner_id = auth.uid()));
create policy "AAR owner delete" on public.aar_assessments for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = aar_assessments.audit_job_id and j.owner_id = auth.uid()));

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on storage.buckets to service_role;
grant execute on function auth.uid() to authenticated, service_role;
