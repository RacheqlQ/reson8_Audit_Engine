export interface RenderFreeServiceKeepaliveOptions {
  enabled?: boolean;
  baseUrl?: string;
  intervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  jobId?: string;
  onFailure?: (error: unknown) => void;
}

/**
 * Keep a Render Free web service receiving occasional inbound traffic while
 * its embedded worker owns a long-running job. The timer exists only for the
 * lifetime of that claimed job and is disabled outside Render by default.
 */
export function startRenderFreeServiceKeepalive(
  options: RenderFreeServiceKeepaliveOptions = {},
): () => void {
  const enabled = options.enabled ?? process.env.RENDER === "true";
  const baseUrl = options.baseUrl ?? process.env.RENDER_EXTERNAL_URL;
  if (!enabled || !baseUrl) return () => undefined;

  let healthUrl: URL;
  try {
    healthUrl = new URL("/health", baseUrl);
  } catch (error) {
    options.onFailure?.(error);
    return () => undefined;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? 10 * 60_000;
  const timeoutMs = options.timeoutMs ?? 5_000;
  let stopped = false;
  let inFlight = false;
  let activeController: AbortController | null = null;

  const onFailure = options.onFailure ?? ((error: unknown) => {
    console.warn(JSON.stringify({
      worker: "audit",
      jobId: options.jobId,
      event: "render_free_keepalive_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  });

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    activeController = new AbortController();
    const timeout = setTimeout(() => {
      activeController?.abort(new Error("AUDIT_RENDER_KEEPALIVE_TIMEOUT"));
    }, timeoutMs);
    timeout.unref?.();

    void fetchImpl(healthUrl, {
      method: "GET",
      signal: activeController.signal,
    }).then((response) => {
      if (!response.ok) onFailure(new Error("Render keepalive returned HTTP " + response.status));
    }).catch((error: unknown) => {
      if (!stopped) onFailure(error);
    }).finally(() => {
      clearTimeout(timeout);
      activeController = null;
      inFlight = false;
    });
  }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
    activeController?.abort(new Error("AUDIT_RENDER_KEEPALIVE_STOPPED"));
  };
}
