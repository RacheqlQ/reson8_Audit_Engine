import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("sample-report command", () => {
  it("uses the local fixture and report generator without external service clients", async () => {
    const script = await readFile(new URL("scripts/sample-report.mjs", root), "utf8");
    expect(script).toContain("../dist/reports/generate-audit-report.js");
    expect(script).toContain("./fixtures/sample-report-input.mjs");
    expect(script).toContain("../artifacts/");
    expect(script).toContain('tier === "sample" ? 3 : 16');
    expect(script).not.toMatch(/GroqClient|SupabaseClient|createSupabaseAuditStore|fetch\s*\(/);
  });

  it("is exposed as an npm script that builds before generating PDFs", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    expect(packageJson.scripts["sample-report"]).toBe("npm run build && node scripts/sample-report.mjs");
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    expect(workflow).toContain("path: artifacts/*.pdf");
    expect(workflow.match(/if: always\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
