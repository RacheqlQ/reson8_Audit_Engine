import { describe, expect, it } from "vitest";
import { SharedTokenPerMinuteLimiter } from "../src/providers/token-per-minute-limiter.js";

describe("SharedTokenPerMinuteLimiter", () => {
  it("serializes reservations across callers within one rolling minute", async () => {
    let now = 1_000;
    const limiter = new SharedTokenPerMinuteLimiter(10, 60_000, () => now);
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); now += ms; };
    await limiter.acquire(6, sleep);
    await limiter.acquire(6, sleep);
    expect(waits).toEqual([60_000]);
  });

  it("rejects a single request larger than the configured shared budget", async () => {
    const limiter = new SharedTokenPerMinuteLimiter(5);
    await expect(limiter.acquire(6, async () => {})).rejects.toThrow("TOKEN_BUDGET_EXCEEDED");
  });
});
