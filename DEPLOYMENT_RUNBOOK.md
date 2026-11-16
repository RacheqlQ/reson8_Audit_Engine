# PR #19 Production Deployment Runbook

**Execution status:** Prepared only. No production migration, SQL recovery, merge, or Render deployment was executed.

Run these six steps in order during the approved deployment window.

## 1. Drain legacy worker processes

Stop or scale the legacy `reson8-audit-worker` processes to zero. Wait for in-flight work to finish, then verify no legacy worker remains active before proceeding.

## 2. Repair the five historical migration ledger entries

First confirm the production schema already contains the effects of each migration and that the remote ledger has not changed. These commands update migration history only; do not run them if any migration's effects are absent or uncertain.

```sh
supabase migration repair 20261004020000 --status applied --remote=gznwamoxuxzaayjaxvlo
supabase migration repair 20261004032000 --status applied --remote=gznwamoxuxzaayjaxvlo
supabase migration repair 20261004032500 --status applied --remote=gznwamoxuxzaayjaxvlo
supabase migration repair 20261004033000 --status applied --remote=gznwamoxuxzaayjaxvlo
supabase migration repair 20261004034500 --status applied --remote=gznwamoxuxzaayjaxvlo
```

Check remote migration status and confirm `20261110000000` is the only pending repository migration.

## 3. Apply worker lease fencing migration

```sh
supabase db push --remote=gznwamoxuxzaayjaxvlo
```

Review the interactive plan and proceed only if it contains exactly `20261110000000_worker_lease_fencing.sql`.

## 4. Requeue reviewed legacy jobs with NULL leases

Run [`supabase/ops/legacy_processing_job_recovery_draft.sql`](supabase/ops/legacy_processing_job_recovery_draft.sql) only after the fencing migration is applied and all legacy workers remain stopped. Review the preview, enter only individually approved job UUIDs, and inspect the proposed rows and audit-event insert. The script defaults to `ROLLBACK`; change the final statement to `COMMIT` only after explicit operator review. It updates approved eligible jobs to `queued` and inserts an audit event; it does not delete job or result data.

## 5. Merge PR #19 into `main`

After steps 1–4 and required reviews and checks pass, mark PR #19 ready for review and merge it according to repository policy. The current `reson8-audit-worker` service auto-deploys commits to `main`, so this merge will start its Render deployment.

## 6. Deploy the worker on Render and verify health

Monitor the merge-triggered `reson8-audit-worker` deployment in Render. Trigger a manual deploy only if no auto-deploy was created. Verify the deployment is live, then check the worker endpoint:

```sh
curl --fail --show-error --silent --write-out '\nHTTP %{http_code}\n' https://<worker-service-url>/health
```

Expected HTTP status: `200`; expected body: `{"status":"ok","service":"reson8-audit-worker"}`.
