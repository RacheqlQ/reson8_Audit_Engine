import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuditStore } from "../src/integrations/supabase-audit-store.js";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mocks.from }),
}));

describe("audio-only Supabase intake", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.insert.mockReset();
    mocks.insert.mockImplementation((values: Record<string, unknown>) => ({
      select: () => ({
        single: async () => ({ data: { id: "audio-only-job" }, error: null }),
      }),
      values,
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table !== "audit_jobs") throw new Error("Unexpected table: " + table);
      return { insert: mocks.insert };
    });
  });

  it("creates an audio-only job in queued state with an empty catalog metadata object", async () => {
    const store = createSupabaseAuditStore("https://example.supabase.co", "test-secret");
    const deps = store.createJobDependencies();
    await deps.createJob({
      ownerId: null,
      filename: "master.wav",
      mimeType: "audio/wav",
      sizeBytes: 3,
      sha256: "a".repeat(64),
      sourceType: "master",
      catalogUrl: null,
      reportAccessTokenHash: "b".repeat(64),
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      status: "queued",
      source_type: "master",
      catalog_url: null,
      catalog_metadata: {},
    });
  });
});
