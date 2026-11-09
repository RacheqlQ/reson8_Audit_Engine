import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReport } from "../dist/reports/generate-audit-report.js";
import { sampleReportInput } from "./fixtures/sample-report-input.mjs";

const outputDirectory = new URL("../artifacts/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const tier of ["sample", "full"]) {
  const bytes = await generateAuditReport(sampleReportInput, tier);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error(tier + " report did not produce a valid PDF header");
  }
  const document = await PDFDocument.load(bytes);
  const pages = document.getPageCount();
  const minimum = tier === "sample" ? 3 : 12;
  const maximum = tier === "sample" ? 4 : 20;
  if (pages < minimum || pages > maximum) {
    throw new Error(tier + " report page count outside expected range: " + pages);
  }
  const filename = tier + "-audit-report.pdf";
  await writeFile(new URL(filename, outputDirectory), bytes);
  process.stdout.write(tier + ": " + pages + " pages -> artifacts/" + filename + "\n");
}
