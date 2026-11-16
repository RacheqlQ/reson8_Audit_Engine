# Migration baseline recovery

**Recovery source:** read-only query of `supabase_migrations.schema_migrations` in the live Supabase project on 2026-11-10. The stored `statements` array was used to restore the two historical SQL files; the repository's Git history did not contain either filename.

| Version | Name | Recovery |
|---|---|---|
| `20261003235441` | `audit_engine_foundation_schema` | Restored to `supabase/migrations/20261003235441_audit_engine_foundation_schema.sql` |
| `20261006204741` | `allow_anonymous_audit_jobs` | Restored to `supabase/migrations/20261006204741_allow_anonymous_audit_jobs.sql` |

The second migration is the original single statement making `audit_jobs.owner_id` nullable. The foundation migration creates the original single-report `audit_reports(report_version, pdf_path)` table.

## Report schema transition

The later repository migration `20261004032500_reconcile_audit_reports_contract.sql` creates the versioned report contract. A clean replay of the foundation migration therefore needs to preserve the original report table before that contract is created.

`20261004032000_preserve_legacy_audit_reports.sql` performs that transition only when it detects the old columns and only if `audit_reports_legacy` does not already exist. It renames rather than drops the legacy table, preserving its rows, indexes, constraints, RLS state, and policies.

## Ledger caveat

At the time of this audit, the live migration ledger listed the two versions above. The other timestamped SQL files in the repository were not listed in that live ledger, even though the current live catalog contains objects compatible with their intended schema changes. Do not infer that those repository migrations were applied through the Supabase migration system. Keep this distinction in deployment planning.

## Local PostgreSQL 17 harness

`.github/scripts/worker-fencing-schema.sql` creates only platform prerequisites needed for migration replay (`auth.users`, `auth.uid()`, storage bucket/object stubs, and local roles). The workflow then applies every SQL migration in timestamp order, including the PR #19 lease-fencing migration, before running its RPC regressions.

The harness uses PostgreSQL 17 and synthetic rows only. It exercises database-side RPC logic, constraints, RLS metadata, fencing, and transaction behavior. The auth and storage objects are compatibility stubs: this is **not** a hosted Supabase Auth, PostgREST, or Storage API integration test.

No production data, migration ledger, schema, secrets, or environment variables are modified by this recovery or CI harness.
