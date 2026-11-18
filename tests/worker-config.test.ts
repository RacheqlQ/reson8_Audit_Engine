import { describe, expect, it } from "vitest";
import { getStuckJobTimeoutMs } from "../src/jobs/worker-config.js";

describe("stuck audit job timeout configuration", () => {
  it("uses the configured timeout within safe bounds", () => {
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "120000" })).toBe(120000);
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "30000" })).toBe(60000);
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "99999999" })).toBe(3600000);
  });

  it("defaults safely for missing or invalid configuration", () => {
    expect(getStuckJobTimeoutMs({})).toBe(600000);
    expect(getStuckJobTimeoutMs({ AUDIT_STUCK_JOB_TIMEOUT_MS: "not-a-number" })).toBe(600000);
  });
});
