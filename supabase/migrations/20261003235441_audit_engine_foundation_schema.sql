create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds numeric(10,3),
  sha256 text,
  source_audio_path text not null,
  recognition_sample_path text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index audit_jobs_owner_created_idx on public.audit_jobs(owner_id, created_at desc);
create index audit_jobs_status_idx on public.audit_jobs(status);
create unique index audit_jobs_owner_sha256_uidx on public.audit_jobs(owner_id, sha256) where sha256 is not null;

create table public.recognition_results (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null references public.audit_jobs(id) on delete cascade,
  provider text not null check (provider in ('audd')),
  matched boolean not null default false,
  artist text,
  title text,
  album text,
  release_date date,
  label text,
  isrc text,
  timecode text,
  song_link text,
  confidence numeric(6,5),
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(audit_job_id, provider)
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
  confidence numeric(6,5),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sonic_dna (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  analysis_version text not null,
  duration_seconds numeric(10,3),
  sample_rate integer,
  channels integer,
  bpm numeric(8,3),
  key text,
  mode text,
  loudness_lufs numeric(8,3),
  rms_energy numeric(10,6),
  dynamic_range_db numeric(8,3),
  spectral_centroid_hz numeric(12,3),
  spectral_bandwidth_hz numeric(12,3),
  spectral_rolloff_hz numeric(12,3),
  zero_crossing_rate numeric(10,7),
  rhythm_features jsonb not null default '{}'::jsonb,
  harmonic_features jsonb not null default '{}'::jsonb,
  vocal_features jsonb not null default '{}'::jsonb,
  mood_tags jsonb not null default '[]'::jsonb,
  genre_context jsonb not null default '[]'::jsonb,
  raw_features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.aar_assessments (
  id uuid primary key default gen_random_uuid(),
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  model_provider text not null default 'groq',
  model text not null,
  prompt_version text not null,
  overall_score numeric(5,2),
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
  audit_job_id uuid not null unique references public.audit_jobs(id) on delete cascade,
  report_version text not null,
  pdf_path text not null,
  created_at timestamptz not null default now()
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
create index audit_events_job_created_idx on public.audit_events(audit_job_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.audit_jobs enable row level security;
alter table public.recognition_results enable row level security;
alter table public.reconciled_tracks enable row level security;
alter table public.sonic_dna enable row level security;
alter table public.aar_assessments enable row level security;
alter table public.audit_reports enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.profiles, public.audit_jobs, public.recognition_results, public.reconciled_tracks, public.sonic_dna, public.aar_assessments, public.audit_reports, public.audit_events from anon, authenticated;
grant select, insert, update, delete on public.profiles, public.audit_jobs, public.recognition_results, public.reconciled_tracks, public.sonic_dna, public.aar_assessments, public.audit_reports, public.audit_events to authenticated;

create policy "Profiles owner select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Profiles owner insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Profiles owner update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Profiles owner delete" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

create policy "Audit jobs owner select" on public.audit_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Audit jobs owner insert" on public.audit_jobs for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Audit jobs owner update" on public.audit_jobs for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Audit jobs owner delete" on public.audit_jobs for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Recognition owner select" on public.recognition_results for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Recognition owner insert" on public.recognition_results for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Recognition owner update" on public.recognition_results for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Recognition owner delete" on public.recognition_results for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

create policy "Reconciled owner select" on public.reconciled_tracks for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reconciled owner insert" on public.reconciled_tracks for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reconciled owner update" on public.reconciled_tracks for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reconciled owner delete" on public.reconciled_tracks for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

create policy "Sonic DNA owner select" on public.sonic_dna for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Sonic DNA owner insert" on public.sonic_dna for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Sonic DNA owner update" on public.sonic_dna for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Sonic DNA owner delete" on public.sonic_dna for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

create policy "AAR owner select" on public.aar_assessments for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "AAR owner insert" on public.aar_assessments for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "AAR owner update" on public.aar_assessments for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "AAR owner delete" on public.aar_assessments for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

create policy "Reports owner select" on public.audit_reports for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reports owner insert" on public.audit_reports for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reports owner update" on public.audit_reports for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Reports owner delete" on public.audit_reports for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

create policy "Events owner select" on public.audit_events for select to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Events owner insert" on public.audit_events for insert to authenticated with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Events owner update" on public.audit_events for update to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid()))) with check (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));
create policy "Events owner delete" on public.audit_events for delete to authenticated using (exists (select 1 from public.audit_jobs j where j.id = audit_job_id and j.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audit-audio', 'audit-audio', false, 52428800, array['audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/x-flac','audio/mp4','audio/aac','audio/ogg']),
  ('audit-reports', 'audit-reports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "Audit audio select own" on storage.objects for select to authenticated
using (bucket_id = 'audit-audio' and owner_id = (select auth.uid()::text));
create policy "Audit audio insert own" on storage.objects for insert to authenticated
with check (bucket_id = 'audit-audio' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Audit audio update own" on storage.objects for update to authenticated
using (bucket_id = 'audit-audio' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'audit-audio' and owner_id = (select auth.uid()::text));
create policy "Audit audio delete own" on storage.objects for delete to authenticated
using (bucket_id = 'audit-audio' and owner_id = (select auth.uid()::text));

create policy "Audit reports select own" on storage.objects for select to authenticated
using (bucket_id = 'audit-reports' and owner_id = (select auth.uid()::text));
create policy "Audit reports insert own" on storage.objects for insert to authenticated
with check (bucket_id = 'audit-reports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Audit reports update own" on storage.objects for update to authenticated
using (bucket_id = 'audit-reports' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'audit-reports' and owner_id = (select auth.uid()::text));
create policy "Audit reports delete own" on storage.objects for delete to authenticated
using (bucket_id = 'audit-reports' and owner_id = (select auth.uid()::text));
