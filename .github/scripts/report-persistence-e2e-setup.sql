-- CI-only fixtures for the report-persistence end-to-end test.
-- This file is executed only against the disposable reson8_test PostgreSQL service.
do $$
begin
  if current_database() <> 'reson8_test' then
    raise exception 'Refusing report-persistence fixtures outside reson8_test';
  end if;
end $$;

do $$
begin
  create role authenticator login password 'reson8-ci-authenticator-only' noinherit;
exception when duplicate_object then
  alter role authenticator login password 'reson8-ci-authenticator-only' noinherit;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to authenticator, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111') on conflict do nothing;
insert into public.profiles(id, display_name)
values ('11111111-1111-4111-8111-111111111111', 'CI report persistence fixture')
on conflict do nothing;

insert into public.audit_jobs(
  id, owner_id, status, original_filename, mime_type, size_bytes, sha256,
  source_audio_path, claim_token, lease_expires_at, worker_id
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','processing','case-a.wav','audio/wav',1,'fixture-a','ci/case-a.wav','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',clock_timestamp()+interval '10 minutes','ci-report-persistence-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','11111111-1111-4111-8111-111111111111','processing','case-b.wav','audio/wav',1,'fixture-b','ci/case-b.wav','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',clock_timestamp()+interval '10 minutes','ci-report-persistence-b'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','processing','case-c.wav','audio/wav',1,'fixture-c','ci/case-c.wav','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',clock_timestamp()+interval '10 minutes','ci-report-persistence-c')
on conflict (id) do nothing;

create or replace function public.ci_abort_report_insert_for_case_b()
returns trigger language plpgsql as $$
begin
  if new.audit_job_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid then
    raise exception 'CI_INJECTED_REPORT_INSERT_ROLLBACK';
  end if;
  return new;
end;
$$;
drop trigger if exists ci_abort_report_insert_for_case_b on public.audit_reports;
create trigger ci_abort_report_insert_for_case_b
before insert on public.audit_reports
for each row execute function public.ci_abort_report_insert_for_case_b();
