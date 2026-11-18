const DEFAULT_STUCK_JOB_TIMEOUT_MS = 10 * 60_000;
const MIN_STUCK_JOB_TIMEOUT_MS = 60_000;
const MAX_STUCK_JOB_TIMEOUT_MS = 60 * 60_000;

export function getStuckJobTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.AUDIT_STUCK_JOB_TIMEOUT_MS);
  if (!Number.isFinite(configured) || !Number.isInteger(configured)) return DEFAULT_STUCK_JOB_TIMEOUT_MS;
  return Math.min(MAX_STUCK_JOB_TIMEOUT_MS, Math.max(MIN_STUCK_JOB_TIMEOUT_MS, configured));
}
