import { describe, expect, it } from "vitest";
import {
  assessVocalAnalysisMemory,
  VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES,
  VOCAL_WORKER_MEMORY_BUDGET_BYTES,
} from "../src/audio/vocal-memory-guard.js";

describe("optional vocal analysis memory preflight", () => {
  it("admits work only when RSS, one PCM working copy and reserve fit the 512 MiB budget", () => {
    const result = assessVocalAnalysisMemory({
      rssBytes: 128 * 1024 * 1024,
      pcmBytes: 32 * 1024 * 1024,
    });
    expect(result.allowed).toBe(true);
    expect(result.estimatedBytes).toBe(128 * 1024 * 1024 + 32 * 1024 * 1024 + VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES);
    expect(result.budgetBytes).toBe(VOCAL_WORKER_MEMORY_BUDGET_BYTES);
    expect(result.reason).toBeNull();
  });

  it("skips optional inference when estimated memory would exceed the budget", () => {
    const result = assessVocalAnalysisMemory({
      rssBytes: 300 * 1024 * 1024,
      pcmBytes: 40 * 1024 * 1024,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("existing audit continues without vocal analysis");
  });

  it("fails closed for invalid memory readings", () => {
    const result = assessVocalAnalysisMemory({ rssBytes: Number.NaN, pcmBytes: 1024 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inputs were invalid");
  });
});
