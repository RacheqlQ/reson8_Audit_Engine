import { describe, expect, it, vi } from "vitest";
import { persistUploadedReport } from "../src/jobs/report-persistence.js";

describe("report persistence outcome reconciliation", () => {
  it("preserves a report when reconciliation confirms the database committed despite a lost response", async () => {
    const cleanup = vi.fn(async () => {});
    const transportError = new Error("database response connection reset");

    await expect(persistUploadedReport({
      upload: async () => {},
      persist: async () => { throw transportError; },
      reconcile: async () => true,
      cleanup,
    })).resolves.toBeUndefined();

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("cleans up only after reconciliation confirms no matching database reference exists", async () => {
    const cleanup = vi.fn(async () => {});
    const transportError = new Error("database response connection reset");
    const reconcile = vi.fn(async () => false);

    await expect(persistUploadedReport({
      upload: async () => {},
      persist: async () => { throw transportError; },
      reconcile,
      cleanup,
    })).rejects.toBe(transportError);

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("preserves the artifact when reconciliation itself fails because the commit outcome remains unknown", async () => {
    const cleanup = vi.fn(async () => {});
    const transportError = new Error("database response connection reset");
    const reconciliationError = new Error("database reconciliation unavailable");

    await expect(persistUploadedReport({
      upload: async () => {},
      persist: async () => { throw transportError; },
      reconcile: async () => { throw reconciliationError; },
      cleanup,
    })).rejects.toMatchObject({
      name: "AggregateError",
      errors: [transportError, reconciliationError],
    });

    expect(cleanup).not.toHaveBeenCalled();
  });
});
