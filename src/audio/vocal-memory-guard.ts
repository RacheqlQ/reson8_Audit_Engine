export const VOCAL_WORKER_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
export const VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES = 192 * 1024 * 1024;

export interface VocalMemoryPreflightInput {
  rssBytes: number;
  pcmBytes: number;
  budgetBytes?: number;
  reserveBytes?: number;
}

export interface VocalMemoryPreflightResult {
  allowed: boolean;
  estimatedBytes: number;
  budgetBytes: number;
  reason: string | null;
}

/**
 * Conservative admission guard for the optional vocal worker.
 * RSS already includes the decoded master; pcmBytes adds one working-copy
 * allowance for resampling/separation, while reserveBytes protects the
 * existing worker from model/runtime allocations. This is a preflight
 * heuristic, not a measured peak-RSS guarantee.
 */
export function assessVocalAnalysisMemory(
  input: VocalMemoryPreflightInput,
): VocalMemoryPreflightResult {
  const budgetBytes = input.budgetBytes ?? VOCAL_WORKER_MEMORY_BUDGET_BYTES;
  const reserveBytes = input.reserveBytes ?? VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES;
  if (
    !Number.isFinite(input.rssBytes) || input.rssBytes < 0
    || !Number.isFinite(input.pcmBytes) || input.pcmBytes < 0
    || !Number.isFinite(budgetBytes) || budgetBytes <= 0
    || !Number.isFinite(reserveBytes) || reserveBytes < 0
  ) {
    return {
      allowed: false,
      estimatedBytes: Number.POSITIVE_INFINITY,
      budgetBytes,
      reason: "Vocal analysis skipped: memory preflight inputs were invalid.",
    };
  }
  const estimatedBytes = input.rssBytes + input.pcmBytes + reserveBytes;
  const allowed = estimatedBytes <= budgetBytes;
  return {
    allowed,
    estimatedBytes,
    budgetBytes,
    reason: allowed
      ? null
      : "Vocal analysis skipped by the conservative memory preflight; the existing audit continues without vocal analysis.",
  };
}
