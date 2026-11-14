export async function readPdfResponse(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!response.ok || !contentType.includes("application/pdf")) {
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
