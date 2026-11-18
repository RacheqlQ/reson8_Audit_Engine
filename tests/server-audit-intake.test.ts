import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";

function deps() {
  return {
    ensureProfile: async () => {},
    createJob: async () => "job-123",
    createCatalogJob: async () => "catalog-job-123",
    uploadMaster: async () => {},
    setSourcePath: async () => {},
    deleteMaster: async () => {},
    deleteJob: async () => {},
  };
}

describe("GET /", () => {
  it("serves the data-ingestion UI without authentication", async () => {
    const app = buildServer({
      authenticate: async () => OWNER_ID,
      resolvePublicOwnerId: async () => OWNER_ID,
      createJobDependencies: () => { throw new Error("must not be called"); },
    } as any);

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Submit a recording for evidence-grade A&R analysis.");

    await app.close();
  });
});

describe("GET /dsp-url.js", () => {
  it("serves the browser DSP detector module required by app.js", async () => {
    const app = buildServer({ createJobDependencies: () => { throw new Error("not used"); } } as any);
    const response = await app.inject({ method: "GET", url: "/dsp-url.js?v=20261116-2" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain("detectTrackPlatform");
    await app.close();
  });
});

describe("GET /health", () => {
  it("returns a healthy Audit Engine status without requiring authentication", async () => {
    const app = buildServer({
      authenticate: async () => OWNER_ID,
      resolvePublicOwnerId: async () => OWNER_ID,
      createJobDependencies: () => { throw new Error("must not be called"); },
    } as any);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "reson8-audit-engine",
      providers: {
        groq: { enabled: expect.any(Boolean), configured: expect.any(Boolean), ready: expect.any(Boolean) },
        gemini: { enabled: expect.any(Boolean), configured: expect.any(Boolean), ready: expect.any(Boolean) },
        ollama: { enabled: expect.any(Boolean), configured: expect.any(Boolean), ready: expect.any(Boolean) },
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("API_KEY");

    await app.close();
  });
});

describe("POST /v1/audits", () => {
  it("accepts a public full-audit submission without a bearer session", async () => {
    const response = await buildServer({
      authenticate: async () => { throw new Error("must not authenticate public requests"); },
      resolvePublicOwnerId: async () => OWNER_ID,
      createJobDependencies: () => deps(),
    } as any).inject({
      method: "POST",
      url: "/v1/audits",
      payload: Buffer.from([1, 2, 3]),
      headers: {
        "content-type": "audio/wav",
        "x-audio-filename": "master.wav",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      jobId: "job-123",
      status: "queued",
    });
  });

  it("accepts a public catalog submission without a bearer session", async () => {
    const response = await buildServer({
      authenticate: async () => { throw new Error("must not authenticate public requests"); },
      resolvePublicOwnerId: async () => OWNER_ID,
      createJobDependencies: () => deps(),
    } as any).inject({
      method: "POST",
      url: "/v1/audits/catalog",
      payload: { url: "https://open.spotify.com/track/3AcgT1ZcF0e9YknCUD269u" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      jobId: "catalog-job-123",
      status: "queued",
      sourceType: "dsp_link",
    });
  });
});
