import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render worker entrypoint", () => {
  it("loads the mounted Render Secrets.env before starting the embedded worker", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.worker).toBe(
      "node --env-file-if-exists=/etc/secrets/Secrets.env dist/worker-main.js",
    );
  });
});
