import { describe, expect, it } from "vitest";
import { createAuditJob } from "../src/jobs/create-audit-job.js";

describe("createAuditJob", () => {
  it("creates an anonymous queued job under the anonymous storage namespace", async () => {
    const calls: string[] = [];
    const result = await createAuditJob(
      {
        ownerId: null,
        filename: "My Song.wav",
        mimeType: "audio/wav",
        bytes: new Uint8Array([1, 2, 3]),
      },
      {
        ensureProfile: async () => {
          calls.push("profile");
        },
        createJob: async (input) => {
          calls.push("job");
          expect(input.ownerId).toBeNull();
          expect(input.sourceType).toBe("master");
          expect(input.catalogUrl).toBeNull();
          expect(input.sha256).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
          return "job-123";
        },
        createCatalogJob: async () => "catalog-job",
        uploadMaster: async (path) => {
          calls.push("upload");
          expect(path).toBe("anonymous/job-123/My Song.wav");
        },
        setSourcePath: async (jobId, path) => {
          calls.push("path");
          expect(jobId).toBe("job-123");
          expect(path).toBe("anonymous/job-123/My Song.wav");
        },
        deleteMaster: async () => {
          calls.push("delete");
        },
      },
    );

    expect(result).toEqual({
      jobId: "job-123",
      sourceAudioPath: "anonymous/job-123/My Song.wav",
      sha256: expect.any(String),
      sourceType: "master",
    });
    expect(calls).toEqual(["job", "upload", "path"]);
  });

  it("cleans up the database job and uploaded master when storage upload fails", async () => {
    const calls: string[] = [];
    await expect(
      createAuditJob(
        {
          ownerId: null,
          filename: "master.wav",
          mimeType: "audio/wav",
          bytes: new Uint8Array([1]),
        },
        {
          ensureProfile: async () => calls.push("profile"),
          createJob: async () => {
            calls.push("job");
            return "job-123";
          },
          createCatalogJob: async () => "catalog-job",
          uploadMaster: async () => {
            calls.push("upload");
            throw new Error("storage unavailable");
          },
          setSourcePath: async () => calls.push("path"),
          deleteMaster: async () => calls.push("delete-master"),
          deleteJob: async () => calls.push("delete-job"),
        },
      ),
    ).rejects.toThrow("storage unavailable");

    expect(calls).toEqual(["job", "upload", "delete-master", "delete-job"]);
  });

  it("cleans up the uploaded master when finalizing the job fails", async () => {
    const calls: string[] = [];

    await expect(
      createAuditJob(
        {
          ownerId: null,
          filename: "master.wav",
          mimeType: "audio/wav",
          bytes: new Uint8Array([1]),
        },
        {
          ensureProfile: async () => calls.push("profile"),
          createJob: async () => "job-123",
          createCatalogJob: async () => "catalog-job",
          uploadMaster: async () => calls.push("upload"),
          setSourcePath: async () => {
            calls.push("path");
            throw new Error("database unavailable");
          },
          deleteMaster: async () => calls.push("delete-master"),
          deleteJob: async () => calls.push("delete-job"),
        },
      ),
    ).rejects.toThrow("database unavailable");

    expect(calls).toEqual(["upload", "path", "delete-master", "delete-job"]);
  });
  it("creates one combined job when both master audio and a DSP link are supplied", async () => {
    let created: any;
    const result = await createAuditJob({
      ownerId: null,
      filename: "combined.wav",
      mimeType: "audio/wav",
      bytes: new Uint8Array([1, 2, 3]),
      catalogUrl: "https://open.spotify.com/track/abc",
    }, {
      createJob: async (input) => { created = input; return "combined-job"; },
      createCatalogJob: async () => { throw new Error("must not create a second job"); },
      uploadMaster: async () => {},
      setSourcePath: async () => {},
      deleteMaster: async () => {},
    });

    expect(created).toMatchObject({
      sourceType: "combined",
      catalogUrl: "https://open.spotify.com/track/abc",
    });
    expect(result).toMatchObject({ jobId: "combined-job", sourceType: "combined" });
  });

});
