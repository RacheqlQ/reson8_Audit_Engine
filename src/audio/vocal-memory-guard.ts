import { readFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";

export const VOCAL_WORKER_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
export const VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES = 192 * 1024 * 1024;
const CGROUP_V2_LIMIT = "/sys/fs/cgroup/memory.max";
const CGROUP_V2_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_V1_LIMIT = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
const CGROUP_V1_CURRENT = "/sys/fs/cgroup/memory/memory.usage_in_bytes";

export interface EffectiveMemoryBudget {
  limitBytes: number;
  availableBytes: number;
  source: "cgroup-v2" | "cgroup-v1" | "os";
}

function parseCgroupBytes(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized || normalized === "max") return null;
  const parsed = Number(normalized);
  // cgroup v1 commonly reports a very large sentinel for an unlimited limit.
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed >= 2 ** 60) return null;
  return parsed;
}

/** Resolve the container's effective memory ceiling and current headroom. */
export async function readEffectiveMemoryBudget(
  readText: (path: string) => Promise<string> = async (path) => readFile(path, "utf8"),
  osTotalBytes = totalmem(),
  osAvailableBytes = freemem(),
): Promise<EffectiveMemoryBudget> {
  const [v2LimitText, v2CurrentText] = await Promise.all([
    readText(CGROUP_V2_LIMIT).catch(() => null),
    readText(CGROUP_V2_CURRENT).catch(() => null),
  ]);
  const v2Limit = parseCgroupBytes(v2LimitText);
  const v2Current = parseCgroupBytes(v2CurrentText);
  if (v2Limit !== null) {
    return {
      limitBytes: v2Limit,
      availableBytes: Math.max(0, Math.min(v2Limit - (v2Current ?? 0), osAvailableBytes)),
      source: "cgroup-v2",
    };
  }

  const [v1LimitText, v1CurrentText] = await Promise.all([
    readText(CGROUP_V1_LIMIT).catch(() => null),
    readText(CGROUP_V1_CURRENT).catch(() => null),
  ]);
  const v1Limit = parseCgroupBytes(v1LimitText);
  const v1Current = parseCgroupBytes(v1CurrentText);
  if (v1Limit !== null) {
    return {
      limitBytes: v1Limit,
      availableBytes: Math.max(0, Math.min(v1Limit - (v1Current ?? 0), osAvailableBytes)),
      source: "cgroup-v1",
    };
  }
  return { limitBytes: osTotalBytes, availableBytes: osAvailableBytes, source: "os" };
}

export interface VocalMemoryPreflightInput {
  rssBytes: number;
  pcmBytes: number;
  budgetBytes?: number;
  availableBytes?: number;
  durationSeconds?: number;
  sampleRate?: number;
  reserveBytes?: number;
}

export interface VocalMemoryPreflightResult {
  allowed: boolean;
  estimatedBytes: number;
  budgetBytes: number;
  reason: string | null;
}

/**
 * Conservative admission guard for optional vocal analysis.
 * The estimate accounts for the resident process, two PCM-sized working
 * allocations and a fixed runtime/model reserve. Duration and sample rate
 * are validated and retained in diagnostics; pcmBytes is the decoded source
 * allocation and therefore remains the authoritative input-size measure.
 * This is a preflight estimate, not a measured peak-RSS guarantee.
 */
export function assessVocalAnalysisMemory(
  input: VocalMemoryPreflightInput,
): VocalMemoryPreflightResult {
  const budgetBytes = input.budgetBytes ?? VOCAL_WORKER_MEMORY_BUDGET_BYTES;
  const availableBytes = input.availableBytes ?? budgetBytes;
  const reserveBytes = input.reserveBytes ?? VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES;
  const formatValid = (input.durationSeconds === undefined || (Number.isFinite(input.durationSeconds) && input.durationSeconds > 0))
    && (input.sampleRate === undefined || (Number.isFinite(input.sampleRate) && input.sampleRate >= 4000));
  if (
    !Number.isFinite(input.rssBytes) || input.rssBytes < 0
    || !Number.isFinite(input.pcmBytes) || input.pcmBytes < 0
    || !Number.isFinite(budgetBytes) || budgetBytes <= 0
    || !Number.isFinite(availableBytes) || availableBytes < 0
    || !Number.isFinite(reserveBytes) || reserveBytes < 0
    || !formatValid
  ) {
    return {
      allowed: false,
      estimatedBytes: Number.POSITIVE_INFINITY,
      budgetBytes,
      reason: "Vocal analysis skipped: memory preflight inputs were invalid.",
    };
  }
  const workingBytes = input.pcmBytes * 2 + reserveBytes;
  const estimatedBytes = input.rssBytes + workingBytes;
  const allowed = estimatedBytes <= budgetBytes && workingBytes <= availableBytes;
  const mb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
  return {
    allowed,
    estimatedBytes,
    budgetBytes,
    reason: allowed
      ? null
      : "vocal separation skipped: needs ~" + mb(workingBytes) + " MB additional memory, limit " + mb(budgetBytes) + " MB; available " + mb(availableBytes) + " MB.",
  };
}
