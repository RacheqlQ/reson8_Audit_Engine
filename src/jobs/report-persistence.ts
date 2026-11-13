export interface UploadedReportPersistence {
  signal?: AbortSignal;
  upload(): Promise<void>;
  persist(): Promise<void>;
  cleanup(): Promise<void>;
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("AUDIT_LEASE_LOST");
}

/**
 * Keeps the uploaded object and its fenced database reference consistent.
 * The Storage REST upload accepts an AbortSignal, but an aborted response can
 * still leave the server-side result uncertain. Cleanup is therefore awaited
 * whenever upload completion is ambiguous or shutdown wins. Once the fenced
 * database write has started, it is awaited to avoid deleting an object whose
 * database reference may have committed despite a transport abort.
 */
export async function persistUploadedReport(input: UploadedReportPersistence): Promise<void> {
  input.signal?.throwIfAborted();
  try {
    await input.upload();
  } catch (uploadError) {
    if (input.signal?.aborted) {
      try {
        await input.cleanup();
      } catch (cleanupError) {
        throw new AggregateError([uploadError, cleanupError], "Aborted report upload failed and artifact cleanup failed");
      }
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
    try {
      await input.cleanup();
    } catch (cleanupError) {
      throw new AggregateError([persistError, cleanupError], "Report persistence failed and uploaded artifact cleanup failed");
    }
    throw persistError;
  }
}
