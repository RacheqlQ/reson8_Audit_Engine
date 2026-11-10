-- Worker lease fencing for Reson8 Audit Engine.
-- Apply only after review; this migration is intentionally not executed by CI or this change.

alter table public.audit_jobs
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_jobs_claim_lease_consistency'
      and conrelid = 'public.audit_jobs'::regclass
  ) then
    alter table public.audit_jobs
      add constraint audit_jobs_claim_lease_consistency
      check (
        (claim_token is null and lease_expires_at is null and worker_id is null)
        or
        (claim_token is not null and lease_expires_at is not null and worker_id is not null)
      ) not valid;
  end if;
end $$;

create index if not exists audit_jobs_claimable_lease_idx
  on public.audit_jobs (status, lease_expires_at, created_at);

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
    and (source_type is distinct from 'master' or source_audio_path is not null)
    and (source_type is distinct from 'dsp_link' or catalog_url is not null)
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

create or replace function public.renew_audit_job_lease(
  p_job_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 180
)
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expiry timestamptz;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease_seconds must be between 30 and 3600' using errcode = '22023';
  end if;

  update public.audit_jobs
  set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_expires_at > clock_timestamp()
  returning lease_expires_at into v_expiry;

  if v_expiry is null then
    raise exception 'AUDIT_LEASE_LOST' using errcode = 'P0001';
  end if;
  return v_expiry;
end;
$$;

-- Every database-side worker mutation and its event are committed in one transaction.
-- The job row lock serializes lease checks, heartbeat, report version allocation and terminal state.
create or replace function public.persist_fenced_audit_step(
  p_job_id uuid,
  p_claim_token uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.audit_jobs%rowtype;
  v_version integer;
  v_event_type text;
  v_event_status text;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_job
  from public.audit_jobs
  where id = p_job_id
  for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= clock_timestamp() then
    raise exception 'AUDIT_LEASE_LOST' using errcode = 'P0001';
  end if;

  case p_operation
    when 'processing_started' then
      v_event_type := 'processing_started';
      v_event_status := 'processing';

    when 'catalog_metadata' then
      update public.audit_jobs
      set catalog_platform = p_payload->>'platform',
          catalog_id = p_payload->>'catalogId',
          catalog_metadata = p_payload->'raw'
      where id = p_job_id;
      v_event_type := 'catalog_ingestion';
      v_event_status := coalesce(p_payload->>'evidenceStatus', 'recognized');

    when 'recognition' then
      insert into public.recognition_results (
        audit_job_id, provider, matched, artist, title, album, release_date,
        label, isrc, timecode, song_link, raw_response
      ) values (
        p_job_id, 'audd', coalesce((p_payload->>'matched')::boolean, false),
        p_payload->>'artist', p_payload->>'title', p_payload->>'album',
        nullif(p_payload->>'releaseDate', '')::date, p_payload->>'label',
        p_payload->>'isrc', p_payload->>'timecode', p_payload->>'songLink',
        coalesce(p_payload->'rawResponse', '{}'::jsonb)
      )
      on conflict (audit_job_id, provider) do update set
        matched = excluded.matched, artist = excluded.artist, title = excluded.title,
        album = excluded.album, release_date = excluded.release_date, label = excluded.label,
        isrc = excluded.isrc, timecode = excluded.timecode, song_link = excluded.song_link,
        raw_response = excluded.raw_response;
      v_event_type := 'recognition';
      v_event_status := case when coalesce((p_payload->>'matched')::boolean, false) then 'matched' else 'unmatched' end;

    when 'evidence' then
      insert into public.reconciled_tracks (
        audit_job_id, canonical_artist, canonical_title, album, release_date,
        label, isrc, upc, spotify_id, apple_music_id, musicbrainz_id,
        evidence_status, confidence, sources
      ) values (
        p_job_id, p_payload->>'canonicalArtist', p_payload->>'canonicalTitle',
        p_payload->>'album', nullif(p_payload->>'releaseDate', '')::date,
        p_payload->>'label', p_payload->>'isrc', p_payload->>'upc',
        p_payload->>'spotifyId', p_payload->>'appleMusicId', p_payload->>'musicbrainzId',
        p_payload->>'evidenceStatus', null, coalesce(p_payload->'sources', '[]'::jsonb)
      )
      on conflict (audit_job_id) do update set
        canonical_artist = excluded.canonical_artist, canonical_title = excluded.canonical_title,
        album = excluded.album, release_date = excluded.release_date, label = excluded.label,
        isrc = excluded.isrc, upc = excluded.upc, spotify_id = excluded.spotify_id,
        apple_music_id = excluded.apple_music_id, musicbrainz_id = excluded.musicbrainz_id,
        evidence_status = excluded.evidence_status, confidence = null, sources = excluded.sources;
      v_event_type := 'evidence_reconciliation';
      v_event_status := coalesce(p_payload->>'reconciliationStatus', 'unresolved');
      v_result := jsonb_build_object('evidenceStatus', p_payload->>'evidenceStatus');

    when 'sonic_dna' then
      insert into public.sonic_dna (
        audit_job_id, analysis_version, duration_seconds, sample_rate, channels,
        bpm, key, mode, loudness_lufs, rms_energy, dynamic_range_db,
        spectral_centroid_hz, spectral_bandwidth_hz, spectral_rolloff_hz,
        zero_crossing_rate, mood_tags, genre_context, raw_features
      ) values (
        p_job_id, 'audit-engine-0.1.0',
        nullif(p_payload->>'durationSeconds', '')::numeric,
        nullif(p_payload->>'sampleRate', '')::integer,
        nullif(p_payload->>'channels', '')::integer,
        nullif(p_payload->>'bpm', '')::numeric, p_payload->>'key', p_payload->>'mode',
        nullif(p_payload->>'loudnessLufs', '')::numeric,
        nullif(p_payload->>'rmsEnergy', '')::numeric,
        nullif(p_payload->>'dynamicRangeDb', '')::numeric,
        nullif(p_payload->>'spectralCentroidHz', '')::numeric,
        nullif(p_payload->>'spectralBandwidthHz', '')::numeric,
        nullif(p_payload->>'spectralRolloffHz', '')::numeric,
        nullif(p_payload->>'zeroCrossingRate', '')::numeric,
        coalesce(p_payload->'moodTags', '[]'::jsonb),
        coalesce(p_payload->'genreContext', '[]'::jsonb),
        coalesce(p_payload->'rawFeatures', '{}'::jsonb)
      )
      on conflict (audit_job_id) do update set
        analysis_version = excluded.analysis_version, duration_seconds = excluded.duration_seconds,
        sample_rate = excluded.sample_rate, channels = excluded.channels, bpm = excluded.bpm,
        key = excluded.key, mode = excluded.mode, loudness_lufs = excluded.loudness_lufs,
        rms_energy = excluded.rms_energy, dynamic_range_db = excluded.dynamic_range_db,
        spectral_centroid_hz = excluded.spectral_centroid_hz,
        spectral_bandwidth_hz = excluded.spectral_bandwidth_hz,
        spectral_rolloff_hz = excluded.spectral_rolloff_hz,
        zero_crossing_rate = excluded.zero_crossing_rate, mood_tags = excluded.mood_tags,
        genre_context = excluded.genre_context, raw_features = excluded.raw_features;
      update public.audit_jobs
      set duration_seconds = nullif(p_payload->>'durationSeconds', '')::numeric
      where id = p_job_id;
      v_event_type := 'sonic_dna';
      v_event_status := 'completed';

    when 'assessment' then
      insert into public.audit_assessments (
        audit_job_id, provider, model, prompt_version, status, assessment
      ) values (
        p_job_id, 'groq', p_payload->>'model', p_payload->>'promptVersion',
        'completed', p_payload->'assessment'
      )
      on conflict (audit_job_id) do update set
        provider = excluded.provider, model = excluded.model,
        prompt_version = excluded.prompt_version, status = excluded.status,
        assessment = excluded.assessment;
      v_event_type := 'ar_assessment';
      v_event_status := 'completed';

    when 'report' then
      select coalesce(max(version), 0) + 1 into v_version
      from public.audit_reports
      where audit_job_id = p_job_id and tier = p_payload->>'tier';
      insert into public.audit_reports (
        audit_job_id, tier, version, access_status, storage_path, sha256, content_type
      ) values (
        p_job_id, p_payload->>'tier', v_version, 'available',
        p_payload->>'storagePath', p_payload->>'sha256', 'application/pdf'
      );
      v_event_type := 'report_generated';
      v_event_status := 'completed';
      v_result := jsonb_build_object('version', v_version);

    when 'complete' then
      update public.audit_jobs
      set status = 'completed', completed_at = clock_timestamp(),
          error_code = null, error_message = null,
          claim_token = null, lease_expires_at = null, worker_id = null
      where id = p_job_id;
      v_event_type := 'audit_completed';
      v_event_status := 'completed';

    when 'fail' then
      update public.audit_jobs
      set status = 'failed', completed_at = clock_timestamp(),
          error_code = 'AUDIT_PROCESSING_FAILED', error_message = p_payload->>'message',
          claim_token = null, lease_expires_at = null, worker_id = null
      where id = p_job_id;
      v_event_type := 'audit_failed';
      v_event_status := 'failed';

    else
      raise exception 'Unsupported fenced audit operation: %', p_operation using errcode = '22023';
  end case;

  insert into public.audit_events (audit_job_id, event_type, status, message, payload)
  values (
    p_job_id, v_event_type, v_event_status,
    case when p_operation = 'fail' then p_payload->>'message' else null end,
    coalesce(p_payload->'eventPayload', '{}'::jsonb)
  );

  return v_result;
end;
$$;

revoke all on function public.claim_next_audit_job(text, integer) from public, anon, authenticated;
revoke all on function public.renew_audit_job_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.persist_fenced_audit_step(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_audit_job(text, integer) to service_role;
grant execute on function public.renew_audit_job_lease(uuid, uuid, integer) to service_role;
grant execute on function public.persist_fenced_audit_step(uuid, uuid, text, jsonb) to service_role;
