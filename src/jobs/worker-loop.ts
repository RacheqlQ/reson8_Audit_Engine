export interface QueueWorkerLoopOptions {
  processNext: () => Promise<unknown>;
  signal: AbortSignal;
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
}

function waitForNextPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };

    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Polls one job at a time and stops cleanly between jobs when aborted. */
export async function runQueueWorkerLoop({
  processNext,
  signal,
  pollIntervalMs = 15_000,
  onError = () => undefined,
}: QueueWorkerLoopOptions): Promise<void> {
  while (!signal.aborted) {
    try {
      await processNext();
    } catch (error) {
      onError(error);
    }

    if (!signal.aborted) {
      await waitForNextPoll(pollIntervalMs, signal);
    }
  }
}
