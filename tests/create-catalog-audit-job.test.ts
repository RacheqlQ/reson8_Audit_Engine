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
  it("creates one job for multiple canonical DSP sources and hashes their ordered identity", async () => {
    let created: any;
    const result = await createCatalogAuditJob({
      ownerId: null,
      catalogUrl: "https://open.spotify.com/track/spotify-1",
      catalogUrls: [
        "https://open.spotify.com/track/spotify-1?si=tracking",
        "https://www.deezer.com/track/deezer-1?utm_source=tracking",
      ],
    }, {
      createCatalogJob: async (input) => { created = input; return "multi-catalog-job"; },
    });

    expect(created.catalogUrl).toBe("https://open.spotify.com/track/spotify-1");
    expect(created.catalogUrls).toEqual([
      "https://open.spotify.com/track/spotify-1",
      "https://www.deezer.com/track/deezer-1",
    ]);
    expect(result.catalogUrls).toEqual(created.catalogUrls);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

});