import { describe, expect, it, vi } from "vitest";
import { persistUploadedReport } from "../src/jobs/report-persistence.js";

describe("uncertain report upload cleanup", () => {
  it("cleans up after a non-abort network failure and preserves the original upload error", async () => {
    const uploadError = new Error("Storage connection reset after request dispatch");
    const cleanup = vi.fn(async () => {});
    const persist = vi.fn(async () => {});

    await expect(persistUploadedReport({
      upload: async () => { throw uploadError; },
      persist: async () => { await persist(); },
      reconcile: async () => false,
      cleanup,
    })).rejects.toBe(uploadError);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("attempts cleanup exactly once when the server may have accepted an upload before the response failed", async () => {
    let storageAccepted = false;
    const cleanup = vi.fn(async () => { storageAccepted = false; });
    const uploadError = new Error("connection closed before Storage response was received");
    const persist = vi.fn(async () => {});

    await expect(persistUploadedReport({
      upload: async () => {
        storageAccepted = true;
        throw uploadError;
      },
      persist,
      reconcile: async () => false,
      cleanup,
    })).rejects.toBe(uploadError);

    expect(storageAccepted).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves both upload and cleanup failures without retrying cleanup implicitly", async () => {
    const uploadError = new Error("Storage upload outcome unknown");
    const cleanupError = new Error("Storage DELETE timed out");
    const cleanup = vi.fn(async () => { throw cleanupError; });

    await expect(persistUploadedReport({
      upload: async () => { throw uploadError; },
      persist: async () => {},
      reconcile: async () => false,
      cleanup,
    })).rejects.toMatchObject({
      name: "AggregateError",
      errors: [uploadError, cleanupError],
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
