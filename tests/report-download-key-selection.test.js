import { describe, expect, it } from "vitest";
import { selectReportAccessKey } from "../public/report-download.js";

const issuedKey = "0123456789abcdef".repeat(4);

describe("full-report access key selection", () => {
  it("uses the issued key when the pasted field contains an audit ID or other malformed value", () => {
    expect(selectReportAccessKey("2e5db299-0c02-4128-bb11-835124d62133", issuedKey)).toBe(issuedKey);
  });

  it("uses a valid pasted key when supplied", () => {
    const pastedKey = "abcdef0123456789".repeat(4);
    expect(selectReportAccessKey(pastedKey, issuedKey)).toBe(pastedKey);
  });

  it("uses the issued key when the pasted field is empty", () => {
    expect(selectReportAccessKey("", issuedKey)).toBe(issuedKey);
  });

  it("preserves malformed input for strict validation when no valid issued key exists", () => {
    const malformed = "not-a-private-key";
    expect(selectReportAccessKey(malformed, null)).toBe(malformed);
  });
});
