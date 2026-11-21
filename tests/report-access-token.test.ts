import { describe, expect, it } from "vitest";
import { createAuditJob } from "../src/jobs/create-audit-job.js";
import { createCatalogAuditJob } from "../src/jobs/create-catalog-audit-job.js";
import { hashReportAccessKey, normalizeReportAccessKey } from "../src/jobs/report-access-token.js";

describe("report access key normalization and issuance", () => {
  it("round-trips the key returned by master submission through the stored SHA-256 digest", async () => {
    let storedHash = "";
    const issued = await createAuditJob({
      ownerId: null, filename: "track.wav", mimeType: "audio/wav", bytes: new Uint8Array([1, 2, 3]),
    }, {
      createJob: async (input) => { storedHash = input.reportAccessTokenHash; return "audit-a"; },
      createCatalogJob: async () => "unused",
      uploadMaster: async () => {}, setSourcePath: async () => {}, deleteMaster: async () => {},
    });
    expect(await hashReportAccessKey(normalizeReportAccessKey(issued.reportAccessToken).value)).toBe(storedHash);
  });

  it("round-trips the same key after a simulated response retry without issuing a second key for that job", async () => {
    let created = 0;
    let storedHash = "";
    const issued = await createCatalogAuditJob({ ownerId: null, catalogUrl: "https://open.spotify.com/track/abc" }, {
      createCatalogJob: async (input) => { created += 1; storedHash = input.reportAccessTokenHash; return "audit-retry"; },
    });
    const simulatedResponseRetry = { jobId: "audit-retry", reportAccessToken: issued.reportAccessToken };
    expect(created).toBe(1);
    expect(await hashReportAccessKey(simulatedResponseRetry.reportAccessToken)).toBe(storedHash);
  });

  it("normalizes trailing spaces and newline", () => {
    const key = "a".repeat(64);
    expect(normalizeReportAccessKey(key + "  \n").value).toBe(key);
    expect(normalizeReportAccessKey(key + "  \n").valid).toBe(true);
  });

  it("normalizes uppercase hexadecimal keys", () => {
    expect(normalizeReportAccessKey("A".repeat(64)).value).toBe("a".repeat(64));
    expect(normalizeReportAccessKey("A".repeat(64)).valid).toBe(true);
  });

  it.each(["a".repeat(63), "g".repeat(64)])("rejects malformed keys without changing their value", (key) => {
    expect(normalizeReportAccessKey(key).valid).toBe(false);
  });

  it("counts whitespace and non-hex characters without logging or retaining a hash", () => {
    const normalized = normalizeReportAccessKey("  " + "a".repeat(63) + "g\n");
    expect(normalized.whitespaceRemoved).toBe(3);
    expect(normalized.nonHexRemoved).toBe(1);
    expect(normalized.value).toBe("a".repeat(63) + "g");
  });
});
