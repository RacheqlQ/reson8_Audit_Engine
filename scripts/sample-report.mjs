import { mkdir,writeFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import { generateAuditReport } from "../dist/reports/generate-audit-report.js";
import { sampleReportInput } from "./fixtures/sample-report-input.mjs";
const out=new URL("../artifacts/",import.meta.url);await mkdir(out,{recursive:true});
const base=sampleReportInput;
const variants=[
 ["complete-supplied-evidence",base],
 ["partial-low-confidence",{...base,auditId:"fixture-partial-low-confidence",assessment:{...base.assessment,confidence:0.28},sonicDna:{...base.sonicDna,key:null,mode:null}}],
 ["metadata-only",{...base,auditId:"fixture-metadata-only",evidence:{...base.evidence,auditType:"METADATA-BASED AUDIT"},sonicDna:null}]
];
for(const [name,input] of variants)for(const tier of ["sample","full"]){
 const bytes=await generateAuditReport(input,tier),pdf=await PDFDocument.load(bytes),pages=pdf.getPageCount();
 if(pages>20)throw new Error(name+" "+tier+" exceeded 20 pages");
 const filename=name+"-"+tier+"-audit-report.pdf";await writeFile(new URL(filename,out),bytes);
 process.stdout.write(filename+": "+pages+" pages\n");
}
