import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render package command contract", () => {
  it("maps every checked-in Render build and start command to an existing npm script", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
    const buildCommand = renderYaml.match(/^\s+buildCommand:\s*(.+)$/m)?.[1]?.trim();
    const startCommand = renderYaml.match(/^\s+startCommand:\s*(.+)$/m)?.[1]?.trim();

    for (const command of [buildCommand, startCommand]) {
      if (!command) continue;
      const scripts = [...command.matchAll(/npm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);
      for (const script of scripts) {
        if (script === "install" || script === "ci") continue;
        expect(packageJson.scripts?.[script], command).toBeTruthy();
      }
    }
  });
});
