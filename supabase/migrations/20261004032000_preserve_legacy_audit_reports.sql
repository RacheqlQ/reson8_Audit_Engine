-- Preserve the original single-report table before introducing the versioned report contract.
-- The foundation migration created audit_reports(report_version, pdf_path). Later migrations
-- require audit_reports(tier, version, storage_path, sha256). Keep legacy rows intact.
do $$
begin
  if to_regclass('public.audit_reports') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_reports'
         and column_name = 'report_version'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_reports'
         and column_name = 'tier'
     ) then
    if to_regclass('public.audit_reports_legacy') is not null then
      raise exception 'audit_reports_legacy already exists; refusing to overwrite preserved report data';
    end if;
    alter table public.audit_reports rename to audit_reports_legacy;
  end if;
end
$$;
