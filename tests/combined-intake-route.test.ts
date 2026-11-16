import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("combined audit intake route", () => {
  it("stores the master and DSP URL on one combined job", async () => {
    let created: any;
    const app = buildServer({
      createJobDependencies: () => ({
        createJob: async (input: any) => { created = input; return "combined-job"; },
        createCatalogJob: async () => { throw new Error("a second DSP-only job must not be created"); },
        uploadMaster: async () => {},
        setSourcePath: async () => {},
        deleteMaster: async () => {},
      }),
      getAuditStatus: async () => ({ jobId: "combined-job", status: "queued" as const, currentStepIndex: 0, full: { available: false } }),
      getAuditReport: async () => { throw new Error("not used"); },
    } as any);

    const response = await app.inject({
      method: "POST",
      url: "/v1/audits",
      headers: {
        "content-type": "audio/wav",
        "x-audio-filename": "master.wav",
        "x-catalog-url": "https://open.spotify.com/track/abc",
      },
      payload: Buffer.from([1, 2, 3]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ jobId: "combined-job", sourceType: "combined" });
    expect(created).toMatchObject({
      sourceType: "combined",
      catalogUrl: "https://open.spotify.com/track/abc",
    });
    await app.close();
  });
});
