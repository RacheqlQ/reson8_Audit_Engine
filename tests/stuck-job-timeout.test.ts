import { describe, expect, it } from "vitest";
import { getStuckJobTimeoutMs } from "../src/jobs/stuck-job-timeout.js";

describe("stuck audit job timeout", () => {
  it("defaults to ten minutes", () => {
    expect(getStuckJobTimeoutMs({})).toBe(600_000);
  });

  it("accepts a configured timeout within safe bounds", () => {
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "900000" })).toBe(900_000);
  });

  it("clamps too-short and too-long values", () => {
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "1000" })).toBe(600_000);
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "99999999" })).toBe(3_600_000);
  });

  it("uses the default for invalid values", () => {
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "not-a-number" })).toBe(600_000);
  });
});
