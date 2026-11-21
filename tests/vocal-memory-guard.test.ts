import { describe, expect, it } from "vitest";
import {
  assessVocalAnalysisMemory,
  readEffectiveMemoryBudget,
  VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES,
  VOCAL_WORKER_MEMORY_BUDGET_BYTES,
} from "../src/audio/vocal-memory-guard.js";

describe("optional vocal analysis memory preflight", () => {
  it("admits work only when RSS, two PCM working allocations and reserve fit the effective budget", () => {
    const result = assessVocalAnalysisMemory({
      rssBytes: 128 * 1024 * 1024,
      pcmBytes: 16 * 1024 * 1024,
      availableBytes: 384 * 1024 * 1024,
      durationSeconds: 240,
      sampleRate: 48_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.estimatedBytes).toBe(128 * 1024 * 1024 + 32 * 1024 * 1024 + VOCAL_ANALYSIS_MEMORY_RESERVE_BYTES);
    expect(result.budgetBytes).toBe(VOCAL_WORKER_MEMORY_BUDGET_BYTES);
    expect(result.reason).toBeNull();
  });

  it("skips optional inference with a precise additional-memory and limit reason", () => {
    const result = assessVocalAnalysisMemory({
      rssBytes: 300 * 1024 * 1024,
      pcmBytes: 40 * 1024 * 1024,
      availableBytes: 64 * 1024 * 1024,
      durationSeconds: 240,
      sampleRate: 48_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/vocal separation skipped: needs ~272 MB additional memory, limit 512 MB; available 64 MB/);
  });

  it("fails closed for invalid memory readings and audio format", () => {
    expect(assessVocalAnalysisMemory({ rssBytes: Number.NaN, pcmBytes: 1024 }).allowed).toBe(false);
    expect(assessVocalAnalysisMemory({ rssBytes: 1, pcmBytes: 1024, sampleRate: 1000 }).allowed).toBe(false);
  });

  it("uses cgroup v2 limit and current usage, capped by host available memory", async () => {
    const values: Record<string, string> = {
      "/sys/fs/cgroup/memory.max": String(512 * 1024 * 1024),
      "/sys/fs/cgroup/memory.current": String(300 * 1024 * 1024),
    };
    const result = await readEffectiveMemoryBudget(async (path) => {
      if (!(path in values)) throw new Error("not found");
      return values[path]!;
    }, 8 * 1024 * 1024 * 1024, 256 * 1024 * 1024);
    expect(result).toEqual({
      limitBytes: 512 * 1024 * 1024,
      availableBytes: 212 * 1024 * 1024,
      source: "cgroup-v2",
    });
  });

  it("falls back to cgroup v1 and then OS memory when cgroup files are unavailable", async () => {
    const v1 = await readEffectiveMemoryBudget(async (path) => {
      if (path.endsWith("memory.limit_in_bytes")) return String(1024 * 1024 * 1024);
      if (path.endsWith("memory.usage_in_bytes")) return String(256 * 1024 * 1024);
      throw new Error("not found");
    }, 8 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
    expect(v1.source).toBe("cgroup-v1");
    expect(v1.availableBytes).toBe(768 * 1024 * 1024);

    const fallback = await readEffectiveMemoryBudget(async () => { throw new Error("not found"); }, 4 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
    expect(fallback).toEqual({
      limitBytes: 4 * 1024 * 1024 * 1024,
      availableBytes: 2 * 1024 * 1024 * 1024,
      source: "os",
    });
  });
});
