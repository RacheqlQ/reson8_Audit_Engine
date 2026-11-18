import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render command contract", () => {
  it("maps every declared Render start command to an existing package script", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
    const commands = [...renderYaml.matchAll(/^\s*startCommand:\s*([^\r\n#]+)/gm)].map((match) => match[1].trim());

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const match = command.match(/^(?:npm|yarn)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)$/);
      expect(match, `Unsupported Render start command: ${command}`).not.toBeNull();
      expect(packageJson.scripts?.[match![1]], `Missing package script: ${match![1]}`).toBeTruthy();
    }
    expect(renderYaml).not.toMatch(/^\s*(?:buildCommand|startCommand):.*\byarn\b/gm);
  });

  it("keeps API and standalone worker scripts distinct", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.start).toContain("dist/main.js");
    expect(packageJson.scripts?.worker).toContain("dist/jobs/worker-entrypoint.js");
  });
});
