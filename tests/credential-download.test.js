import { describe, expect, it, vi } from "vitest";
import { credentialFilename, triggerCredentialDownload } from "../public/credential-download.js";
describe("private credential download", () => {
  it("uses a canonical UUID in the download filename", () => {
    expect(credentialFilename("550e8400-e29b-41d4-a716-446655440000")).toBe("reson8-audit-access-550e8400-e29b-41d4-a716-446655440000.txt");
  });
  it.each(["../../secret", "job-1", "550e8400-e29b-41d4-a716-446655440000\\nmalicious"])(
    "uses a fixed safe filename for invalid job identifiers (%s)",
    (jobId) => expect(credentialFilename(jobId)).toBe("reson8-audit-access.txt"),
  );
  it("opens a safe new browsing context and delays Blob revocation for iOS handoff", () => {
    vi.useFakeTimers();
    const click = vi.fn(), remove = vi.fn(), anchor = { click, remove, href: "", download: "", target: "", rel: "" };
    const append = vi.fn(), createObjectURL = vi.fn(() => "blob:reson8-credential"), revokeObjectURL = vi.fn();
    const schedule = vi.fn((callback, delay) => setTimeout(callback, delay));
    triggerCredentialDownload(new Blob(["credential"]), "reson8-audit-access.txt", {
      documentRef: { createElement: () => anchor, body: { append } },
      urlApi: { createObjectURL, revokeObjectURL }, schedule,
    });
    expect(anchor).toMatchObject({ href: "blob:reson8-credential", download: "reson8-audit-access.txt", target: "_blank", rel: "noopener" });
    expect(append).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:reson8-credential");
  });
});
