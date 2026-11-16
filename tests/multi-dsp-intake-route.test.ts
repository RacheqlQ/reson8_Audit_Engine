import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("multi-DSP catalog intake route", () => {
  it("creates one job for up to eight canonical track links", async () => {
    let created: any;
    const app = buildServer({
      createJobDependencies: () => ({
        createJob: async () => { throw new Error("master route not used"); },
        createCatalogJob: async (input: any) => { created = input; return "multi-dsp-job"; },
        uploadMaster: async () => {},
        setSourcePath: async () => {},
        deleteMaster: async () => {},
      }),
      getAuditStatus: async () => ({ jobId: "multi-dsp-job", status: "queued" as const, currentStepIndex: 0, full: { available: false } }),
      getAuditReport: async () => { throw new Error("not used"); },
    } as any);

    const response = await app.inject({
      method: "POST",
      url: "/v1/audits/catalog",
      headers: { "content-type": "application/json" },
      payload: { urls: [
        "https://open.spotify.com/track/spotify-1?si=campaign",
        "https://www.deezer.com/track/deezer-1",
      ] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ jobId: "multi-dsp-job", sourcesSubmitted: 2 });
    expect(created.catalogUrls).toEqual([
      "https://open.spotify.com/track/spotify-1",
      "https://www.deezer.com/track/deezer-1",
    ]);
    await app.close();
  });

  it("rejects nine links without creating a job", async () => {
    let createCount = 0;
    const app = buildServer({
      createJobDependencies: () => ({
        createJob: async () => { throw new Error("not used"); },
        createCatalogJob: async () => { createCount += 1; return "unexpected"; },
        uploadMaster: async () => {},
        setSourcePath: async () => {},
        deleteMaster: async () => {},
      }),
      getAuditStatus: async () => ({ jobId: "x", status: "queued" as const, currentStepIndex: 0, full: { available: false } }),
      getAuditReport: async () => { throw new Error("not used"); },
    } as any);

    const response = await app.inject({
      method: "POST",
      url: "/v1/audits/catalog",
      headers: { "content-type": "application/json" },
      payload: { urls: Array.from({ length: 9 }, (_, index) => `https://open.spotify.com/track/${index}`) },
    });

    expect(response.statusCode).toBe(400);
    expect(createCount).toBe(0);
    await app.close();
  });
});
