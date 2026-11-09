import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
const root=new URL("../",import.meta.url);
describe("sample-report command",()=>{
 it("generates three explicitly labelled fixture pairs without external services",async()=>{
  const script=await readFile(new URL("scripts/sample-report.mjs",root),"utf8");
  expect(script).toContain("../dist/reports/generate-audit-report.js");
  expect(script).toContain("./fixtures/sample-report-input.mjs");
  expect(script).toContain("full-audio-based");expect(script).toContain("partial-audio-low-confidence");expect(script).toContain("metadata-only");
  expect(script).toContain('["sample","full"]');
  expect(script).toContain("FIXTURE");
  expect(script).not.toContain("fetch(");
  const fixture=await readFile(new URL("scripts/fixtures/sample-report-input.mjs",root),"utf8");
  expect(fixture).toContain("Fixture Artist");expect(fixture).toContain("provenance:\"uploaded_audio_master\"");
  expect(fixture).toContain("synthetic fixture");expect(fixture).toContain("sonicDna:null");
 });
 it("is exposed as an npm script that builds before generating PDFs",async()=>{
  const pkg=JSON.parse(await readFile(new URL("package.json",root),"utf8"));
  expect(pkg.scripts["sample-report"]).toBe("npm run build && node scripts/sample-report.mjs");
  const workflow=await readFile(new URL(".github/workflows/ci.yml",root),"utf8");
  expect(workflow).toContain("path: artifacts/*.pdf");
 });
});
