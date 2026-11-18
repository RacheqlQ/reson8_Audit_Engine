import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render command contract", () => {
  it("maps Render's web start command and standalone worker command to package scripts", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
    const startCommand = renderYaml.match(/^\s+startCommand:\s*(.+)$/m)?.[1]?.trim();

    expect(startCommand).toBe("npm start");
    expect(packageJson.scripts?.start).toContain("dist/main.js");
    expect(packageJson.scripts?.worker).toContain("dist/worker-main.js");
    expect(existsSync(new URL("../src/worker-main.ts", import.meta.url))).toBe(true);
    expect(renderYaml).toContain("npm run build");
    expect(renderYaml).not.toMatch(/yarn(?:\s|$)/i);
  });
});
