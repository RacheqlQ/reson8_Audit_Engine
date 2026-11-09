import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReport } from "../dist/reports/generate-audit-report.js";
import { fullAudioFixture, partialAudioFixture, metadataOnlyFixture, longFormAudioFixture } from "./fixtures/sample-report-input.mjs";

const out=new URL("../artifacts/",import.meta.url);
await mkdir(out,{recursive:true});
for(const file of await readdir(out)){if(file.endsWith("-audit-report.pdf"))await rm(new URL(file,out));}
const variants=[
 ["full-audio-based",fullAudioFixture],
 ["partial-audio-low-confidence",partialAudioFixture],
 ["metadata-only",metadataOnlyFixture],
 ["long-form-audio",longFormAudioFixture],
];
for(const [name,input] of variants){
 for(const tier of ["sample","full"]){
  const bytes=await generateAuditReport(input,tier);
  const pdf=await PDFDocument.load(bytes);
  if(pdf.getPageCount()>20)throw new Error(name+" "+tier+" exceeded 20 pages");
  const filename=name+"-"+tier+"-audit-report.pdf";
  await writeFile(new URL(filename,out),bytes);
  process.stdout.write(filename+": "+pdf.getPageCount()+" pages (FIXTURE)\n");
 }
}
