import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render worker entrypoint", () => {
  it("loads the mounted Render Secrets.env before starting the standalone worker", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.worker).toBe(
      "node --env-file-if-exists=/etc/secrets/Secrets.env dist/jobs/worker-entrypoint.js",
    );
    expect(readFileSync(new URL("../src/jobs/worker-entrypoint.ts", import.meta.url), "utf8")).toContain("runAuditQueueWorker");
  });
});
