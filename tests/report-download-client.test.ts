import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeReportAccessKey, readPdfResponse, triggerPdfDownload } from "../public/report-download.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("browser PDF download contract", () => {
  it("preserves every valid hexadecimal character when normalizing a pasted report key", () => {
    const key = "0123456789abcdef".repeat(4);
    expect(normalizeReportAccessKey(key)).toBe(key);
    expect(normalizeReportAccessKey("  \n\t\u200B" + key.toUpperCase() + "  ")).toBe(key);
  });

  it("rejects authorization error JSON without producing a downloadable Blob", async () => {
    const response = new Response(
      JSON.stringify({ error: "OPERATOR_AUTH_REQUIRED", message: "Operator access required." }),
      { status: 403, headers: { "content-type": "application/json; charset=utf-8" } },
    );

    await expect(readPdfResponse(response)).rejects.toThrow("Operator access required.");
  });

  it("rejects a successful response with an incorrect content type", async () => {
    const response = new Response("%PDF-1.7\nfixture", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });

    await expect(readPdfResponse(response)).rejects.toThrow("Report retrieval failed (HTTP 200)");
  });

  it("rejects a media type that only contains the PDF label", async () => {
    const response = new Response("%PDF-1.7\nfixture", {
      status: 200,
      headers: { "content-type": "application/pdfx" },
    });

    await expect(readPdfResponse(response)).rejects.toThrow("Report retrieval failed (HTTP 200)");
  });

  it("rejects application/pdf responses with an invalid PDF signature", async () => {
    const response = new Response("not a PDF document", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });

    await expect(readPdfResponse(response)).rejects.toThrow(
      "Server response was not a valid PDF. No file was downloaded.",
    );
  });

  it("returns a Blob only after content type and PDF signature both pass", async () => {
    const response = new Response("%PDF-1.7\nfixture", {
      status: 200,
      headers: { "content-type": "application/pdf; charset=binary" },
    });

    const blob = await readPdfResponse(response);
    expect(blob.type).toBe("application/pdf;charset=binary");
    expect(await blob.slice(0, 5).text()).toBe("%PDF-");
  });

  it("keeps the object URL alive for the Safari handoff and opens a safe new context", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { click, remove, href: "", download: "", target: "", rel: "" };
    const append = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn(() => "blob:reson8-report");
    const revokeObjectURL = vi.fn();
    const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });

    triggerPdfDownload(blob, "reson8-audit-sample-job-1.pdf", {
      documentRef: { createElement, body: { append } },
      urlApi: { createObjectURL, revokeObjectURL },
    });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor).toMatchObject({
      href: "blob:reson8-report",
      download: "reson8-audit-sample-job-1.pdf",
      target: "_blank",
      rel: "noopener",
    });
    expect(append).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:reson8-report");
  });
});


describe("mobile clipboard report-key normalization", () => {
  it("removes invisible bidirectional formatting marks without accepting non-hex key characters", () => {
    const key = "0123456789abcdef".repeat(4);
    expect(normalizeReportAccessKey("\u200e\u2066" + key + "\u2069\u200f")).toBe(key);
    expect(normalizeReportAccessKey(key + "-")).not.toBe(key);
  });
});
