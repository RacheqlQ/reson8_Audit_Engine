import { describe, expect, it, vi } from "vitest";
import { persistUploadedReport } from "../src/jobs/report-persistence.js";

describe("persistUploadedReport", () => {
  it("removes an upload that completes after shutdown and never starts persistence", async () => {
    const controller = new AbortController();
    let finishUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => { finishUpload = resolve; });
    const cleanup = vi.fn(async () => {});
    const persist = vi.fn(async () => {});
    const pending = persistUploadedReport({
      signal: controller.signal,
      upload: () => uploadGate,
      persist,
      cleanup,
    });

    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    finishUpload();

    await expect(pending).rejects.toThrow("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("surfaces cleanup failure together with the abort reason", async () => {
    const controller = new AbortController();
    const cleanupError = new Error("storage cleanup unavailable");
    const pending = persistUploadedReport({
      signal: controller.signal,
      upload: async () => {},
      persist: async () => {},
      cleanup: async () => { throw cleanupError; },
    });
    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));

    await expect(pending).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "AUDIT_SHUTDOWN_DRAIN_TIMEOUT" }), cleanupError],
    });
  });

  it("waits for an already-started fenced database write to settle before preserving its report object", async () => {
    const controller = new AbortController();
    let finishPersist!: () => void;
    let persistStarted!: () => void;
    const started = new Promise<void>((resolve) => { persistStarted = resolve; });
    const persistGate = new Promise<void>((resolve) => { finishPersist = resolve; });
    const cleanup = vi.fn(async () => {});
    const pending = persistUploadedReport({
      signal: controller.signal,
      upload: async () => {},
      persist: async () => { persistStarted(); await persistGate; },
      cleanup,
    });

    await started;
    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    finishPersist();

    await expect(pending).resolves.toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("does not begin an upload when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("AUDIT_LEASE_LOST"));
    const upload = vi.fn(async () => {});
    await expect(persistUploadedReport({
      signal: controller.signal,
      upload,
      persist: async () => {},
      cleanup: async () => {},
    })).rejects.toThrow("AUDIT_LEASE_LOST");
    expect(upload).not.toHaveBeenCalled();
  });
  it("removes the uploaded object when the fenced database write fails", async () => {
    const cleanup = vi.fn(async () => {});
    const persistError = new Error("AUDIT_LEASE_LOST");
    await expect(persistUploadedReport({
      upload: async () => {},
      persist: async () => { throw persistError; },
      cleanup,
    })).rejects.toBe(persistError);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("removes a possibly accepted storage object when an upload request is aborted", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => {});
    const upload = vi.fn(() => new Promise<void>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    }));
    const pending = persistUploadedReport({
      signal: controller.signal,
      upload,
      persist: async () => {},
      cleanup,
    });

    controller.abort(new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT"));
    await expect(pending).rejects.toThrow("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

});
