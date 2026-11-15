import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render worker entrypoint", () => {
  it("defines the worker command used by the deployed Render service", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.worker).toBe("node dist/main.js");
  });
});
