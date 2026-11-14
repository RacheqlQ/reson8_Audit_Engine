import { describe, expect, it } from "vitest";
import { createCatalogAuditJob } from "../src/jobs/create-catalog-audit-job.js";

describe("createCatalogAuditJob", () => {
  it("creates a DSP-only job and issues a hashed sample-report capability", async () => {
    let created: any;
    const result = await createCatalogAuditJob({
      ownerId: null,
      catalogUrl: "https://open.spotify.com/track/abc",
    }, {
      createCatalogJob: async (input) => { created = input; return "catalog-job"; },
    });

    expect(created).toMatchObject({
      ownerId: null,
      catalogUrl: "https://open.spotify.com/track/abc",
      reportAccessTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result).toMatchObject({
      jobId: "catalog-job",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportAccessToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(created.reportAccessTokenHash).not.toBe(result.reportAccessToken);
  });
  it("rejects unsupported DSP hosts before creating a queued job", async () => {
    await expect(createCatalogAuditJob({ ownerId: null, catalogUrl: "https://example.com/track/abc" }, {
      createCatalogJob: async () => { throw new Error("must not create job"); },
    })).rejects.toThrow("Unsupported DSP or catalog URL");
  });
});
