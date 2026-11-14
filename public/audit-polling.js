export function createAuditPoller({
  fetchImpl = (...args) => fetch(...args),
  onPayload = () => {},
  onMessage = () => {},
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  now = () => Date.now(),
  maxWaitMs = 10 * 60 * 1000,
  retryDelayMs = 2500,
  errorRetryDelayMs = 3000,
} = {}) {
  let timer = null;
  let stopped = true;
  let startedAt = 0;
  function stop() {
    stopped = true;
    if (timer !== null) { clearTimer(timer); timer = null; }
  }
  async function poll(job, token) {
    stop();
    if (!token) {
      onMessage("The private audit access token is unavailable. Submit a new audit to receive a fresh token.");
      return;
    }
    startedAt = now();
    stopped = false;
    async function check() {
      if (stopped) return;
      try {
        const response = await fetchImpl("/v1/audits/" + encodeURIComponent(job), {
          headers: { "x-reson8-report-token": token },
        });
        const payload = await response.json().catch(() => ({}));
        if (stopped) return;
        if ([401, 403, 404].includes(response.status)) {
          stop();
          onMessage("This audit access credential was rejected or is no longer valid. The job ID cannot restore access. If you saved the one-time credential, keep it private and use it while this page is open; otherwise submit a new audit.");
          return;
        }
        if (!response.ok) throw new Error(payload.message || "Temporary status request failure (HTTP " + response.status + ")");
        onPayload(payload);
        if (payload.status === "completed" && payload.full?.available) { stop(); return; }
        if (payload.status === "failed") {
          stop();
          onMessage("Audit failed: " + (payload.errorMessage || "processing error"));
          return;
        }
        if (now() - startedAt >= maxWaitMs) {
          stop();
          onMessage("Audit is still processing. Keep this page open and check the job again shortly.");
          return;
        }
        timer = setTimer(check, retryDelayMs);
      } catch (error) {
        if (stopped) return;
        if (now() - startedAt >= maxWaitMs) {
          stop();
          onMessage(error instanceof Error ? error.message : "Could not read audit status");
          return;
        }
        timer = setTimer(check, errorRetryDelayMs);
      }
    }
    await check();
  }
  return { poll, stop };
}
