import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("sample-report command", () => {
  it("uses the local fixture and report generator without external service clients", async () => {
    const script = await readFile(new URL("scripts/sample-report.mjs", root), "utf8");
    expect(script).toContain("../dist/reports/generate-audit-report.js");
    expect(script).toContain("./fixtures/sample-report-input.mjs");
    expect(script).not.toMatch(/GroqClient|SupabaseClient|createSupabaseAuditStore|fetch\\s*\\(/);
  });

  it("is exposed as an npm script that builds before generating PDFs", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    expect(packageJson.scripts["sample-report"]).toBe("npm run build && node scripts/sample-report.mjs");
  });
});
