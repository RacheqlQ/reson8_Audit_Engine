import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("Render secret-file startup configuration", () => {
  it.each(["start", "worker"])("%s loads the mounted secret.env before importing the app", (script) => {
    expect(packageJson.scripts[script]).toContain(
      "--env-file-if-exists=/etc/secrets/secret.env",
    );
  });
});
