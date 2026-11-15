import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
const root=new URL("../",import.meta.url);
describe("sample-report command",()=>{
 it("generates five generic fixture pairs without external services",async()=>{
  const script=await readFile(new URL("scripts/sample-report.mjs",root),"utf8");
  expect(script).toContain("../dist/reports/generate-audit-report.js");
  expect(script).toContain("./fixtures/sample-report-input.mjs");
  for(const fixtureName of ["full-audio-based","partial-audio-low-confidence","metadata-only","long-form-audio","ambiguous-audio-low-confidence"])expect(script).toContain(fixtureName);
  expect(script).toContain('["sample","full"]');
  expect(script).toContain("FIXTURE");
  expect(script).toContain("generatedAt: new Date().toISOString()");
  expect(script).not.toContain("fetch(");
  const ambiguous=await readFile(new URL("scripts/fixtures/ambiguous-audio.mjs",root),"utf8");
  expect(ambiguous).toContain("insufficient_evidence");
  expect(ambiguous).toContain("tempoConfidence: 0");
  expect(ambiguous).toContain("Sample Release - EP");
  expect(ambiguous).toContain("Generic Test Artist");
  const fixture=await readFile(new URL("scripts/fixtures/sample-report-input.mjs",root),"utf8");
  expect(fixture).toContain("Fixture Artist");
  expect(fixture).toContain('provenance:"uploaded_audio_master"');
  expect(fixture).toContain("synthetic fixture");
  expect(fixture).toContain("sonicDna:null");
 });
 it("is exposed as an npm script that builds before generating PDFs",async()=>{
  const pkg=JSON.parse(await readFile(new URL("package.json",root),"utf8"));
  expect(pkg.scripts["sample-report"]).toBe("npm run build && node scripts/sample-report.mjs");
  const workflow=await readFile(new URL(".github/workflows/ci.yml",root),"utf8");
  expect(workflow).toContain("path: artifacts/*.pdf");
 });
});
