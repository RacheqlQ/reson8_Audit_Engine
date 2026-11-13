export interface UploadedReportPersistence {
  signal?: AbortSignal;
  upload(): Promise<void>;
  persist(): Promise<void>;
  reconcile(): Promise<boolean>;
  cleanup(): Promise<void>;
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_LEASE_LOST");
}

/**
 * Keeps the uploaded object and its fenced database reference consistent.
 * The Storage REST upload accepts an AbortSignal, but an aborted response can
 * still leave the server-side result uncertain. Cleanup is therefore awaited
 * after every upload failure, including non-abort network failures, and when
 * shutdown wins after a successful upload. Once persistence starts, uncertain
 * database outcomes are reconciled under the job-row lock before cleanup.
 */
export async function persistUploadedReport(input: UploadedReportPersistence): Promise<void> {
  input.signal?.throwIfAborted();
  try {
    await input.upload();
  } catch (uploadError) {
    // The Storage server may have accepted the object even when the response
    // was lost. Persistence has not started yet, so no database reference for
    // this claim-token-specific path can exist; attempt bounded cleanup always.
    try {
      await input.cleanup();
    } catch (cleanupError) {
      throw new AggregateError([uploadError, cleanupError], "Report upload failed and artifact cleanup failed");
    }
    throw uploadError;
  }

  if (input.signal?.aborted) {
    const aborted = abortReason(input.signal);
    try {
      await input.cleanup();
    } catch (cleanupError) {
      throw new AggregateError([aborted, cleanupError], "Report upload completed after abort and cleanup failed");
    }
    throw aborted;
  }

  try {
    input.signal?.throwIfAborted();
    await input.persist();
  } catch (persistError) {
    let committed: boolean;
    try {
      // The reconciliation RPC takes the same audit_jobs row lock as the
      // fenced persistence RPC. It therefore waits for an in-flight commit
      // before deciding whether this exact artifact is referenced.
      committed = await input.reconcile();
    } catch (reconciliationError) {
      // Unknown means preserve the artifact. Deleting it could break a
      // transaction that committed despite losing its HTTP response.
      throw new AggregateError(
        [persistError, reconciliationError],
        "Report persistence outcome is unknown; uploaded artifact was preserved",
      );
    }
    if (committed) return;

    try {
      await input.cleanup();
    } catch (cleanupError) {
      throw new AggregateError([persistError, cleanupError], "Report persistence failed and uploaded artifact cleanup failed");
    }
    throw persistError;
  }
}
