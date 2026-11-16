-- Supabase platform prerequisites for replaying the exact repository migration chain.
-- Application tables, indexes, constraints and RLS policies are created by the migrations.
-- No production rows, secrets, or auth identities are copied.

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
exception when duplicate_object then alter role service_role bypassrls; end $$;

create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null,
  owner_id text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(object_name text)
returns text[]
language sql immutable
as $$
  select case
    when cardinality(parts) > 1 then parts[1:cardinality(parts)-1]
    else array[]::text[]
  end
  from (select string_to_array(object_name, '/') as parts) s
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function storage.foldername(text) to authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema storage grant all on tables to service_role;
