import { describe, expect, it } from "vitest";
import { classifyAuditSources } from "../src/jobs/audit-source.js";

describe("classifyAuditSources", () => {
  it("classifies a master-only submission", () => {
    expect(classifyAuditSources({ hasMaster: true, catalogUrl: null })).toBe("master");
  });

  it("classifies a DSP-only submission", () => {
    expect(classifyAuditSources({ hasMaster: false, catalogUrl: "https://open.spotify.com/track/abc" })).toBe("dsp_link");
  });

  it("classifies simultaneous master and DSP inputs as one combined job", () => {
    expect(classifyAuditSources({ hasMaster: true, catalogUrl: "https://open.spotify.com/track/abc" })).toBe("combined");
  });

  it("rejects submissions with neither source", () => {
    expect(() => classifyAuditSources({ hasMaster: false, catalogUrl: null })).toThrow("At least one audit source is required");
  });

  it("rejects unsupported catalog hosts before creating a queued job", () => {
    expect(() => classifyAuditSources({ hasMaster: true, catalogUrl: "https://example.com/track/abc" })).toThrow("Unsupported DSP or catalog URL");
  });

  it("rejects malformed catalog URLs", () => {
    expect(() => classifyAuditSources({ hasMaster: false, catalogUrl: "javascript:alert(1)" })).toThrow("DSP URL must use HTTPS");
  });
});
