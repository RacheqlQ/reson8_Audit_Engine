export function normalizeReportAccessKey(input) {
  let value = String(input ?? "")
    .replace(/[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/^[\"']+|[\"']+$/g, "");
  value = value.replace(/^(?:(?:reson8)?(?:report)?(?:access)?key|bearer)[:=]?/i, "");
  value = value.replace(/^0x/i, "");
  value = value.toLowerCase();
  // Match the server: grouped keys may contain internal separators only.
  if (/^[0-9a-f]+(?:[-:][0-9a-f]+)+$/i.test(value)) {
    value = value.replace(/[-:]/g, "");
  }
  return value;
}

export async function readPdfResponse(response) {
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

  if (!response.ok || contentType !== "application/pdf") {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Report retrieval failed (HTTP " + response.status + ")");
  }

  const blob = await response.blob();
  const signature = await blob.slice(0, 5).text();
  if (signature !== "%PDF-") {
    throw new Error("Server response was not a valid PDF. No file was downloaded.");
  }

  return blob;
}

export function triggerPdfDownload(
  blob,
  filename,
  {
    documentRef = document,
    urlApi = URL,
    revokeDelayMs = 60_000,
  } = {},
) {
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Safari on iOS may ignore the download attribute; a new browsing context
  // lets its native PDF viewer handle the Blob URL instead of a dead click.
  anchor.target = "_blank";
  anchor.rel = "noopener";
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Do not revoke immediately: Safari can still be opening the PDF when the
  // click handler returns. Keep the URL alive long enough for navigation.
  setTimeout(() => urlApi.revokeObjectURL(url), revokeDelayMs);
}
