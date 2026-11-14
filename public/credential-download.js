const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function credentialFilename(jobId) {
  const safeId = typeof jobId === "string" && UUID_PATTERN.test(jobId) ? jobId.toLowerCase() : null;
  return safeId ? "reson8-audit-access-" + safeId + ".txt" : "reson8-audit-access.txt";
}
export function triggerCredentialDownload(blob, filename, {
  documentRef = document,
  urlApi = URL,
  revokeDelayMs = 60_000,
  schedule = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Safari on iOS may ignore download; the new context enables its Share/Save flow.
  anchor.target = "_blank";
  anchor.rel = "noopener";
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
  schedule(() => urlApi.revokeObjectURL(url), revokeDelayMs);
}
