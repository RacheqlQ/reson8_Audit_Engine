import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { ArAssessment } from "../providers/groq/client.js";

export type AuditReportTier = "sample" | "full";

export interface AuditReportInput {
  auditId: string;
  generatedAt: string;
  evidence: Record<string, unknown>;
  sonicDna: Record<string, unknown> | null;
  assessment: ArAssessment;
}

function value(input: unknown): string {
  if (input === null || input === undefined || input === "") return "Not available";
  if (Array.isArray(input)) return input.map((item) => value(item)).join(", ");
  if (typeof input === "object") return JSON.stringify(input);
  return String(input);
}

function wrap(input: string, max = 88): string[] {
  const words = input.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function addEditableField(
  pdf: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  name: string,
  content: string,
  y: number,
  height: number,
): number {
  const field = pdf.getForm().createTextField(name);
  field.enableMultiline();
  field.setText(content.slice(0, 8000));
  field.addToPage(page, { x: 48, y: y - height, width: 516, height });
  field.setFontSize(9);
  field.updateAppearances(font);
  return y - height - 18;
}

function drawPageHeader(page: PDFPage, title: string, pageNumber: number, font: PDFFont, bold: PDFFont): void {
  page.drawText("RESON8 | A&R INTELLIGENCE", { x: 48, y: 754, size: 8, font: bold, color: rgb(0.25, 0.28, 0.33) });
  page.drawText(title, { x: 48, y: 716, size: 19, font: bold, color: rgb(0.05, 0.07, 0.1) });
  page.drawText("PRIVATE AUDIT | " + pageNumber, { x: 490, y: 28, size: 7, font, color: rgb(0.35, 0.37, 0.4) });
}

function drawBody(page: PDFPage, paragraphs: string[], font: PDFFont, startY = 680): number {
  let y = startY;
  for (const paragraph of paragraphs) {
    for (const line of wrap(paragraph)) {
      if (y < 62) return y;
      page.drawText(line, { x: 48, y, size: 9, font, color: rgb(0.12, 0.14, 0.17) });
      y -= 14;
    }
    y -= 10;
  }
  return y;
}

function evidenceLabelLines(assessment: ArAssessment): string[] {
  return assessment.evidenceLabels.map((item) => item.label + " | " + item.claim + " | Source: " + item.source);
}

function sonicLines(input: AuditReportInput): string[] {
  if (!input.sonicDna) return ["No master-derived or provider sonic profile was available for this audit."];
  const source = input.sonicDna.provenance === "tidal_catalog_metadata"
    ? "METADATA-BASED AUDIT: sonic details are provider catalog metadata, not master-derived measurements."
    : "OBSERVED: sonic measurements are derived from the supplied audio master.";
  return [
    source,
    "BPM: " + value(input.sonicDna.bpm),
    "Key: " + value(input.sonicDna.key),
    "Mode: " + value(input.sonicDna.mode),
    "Loudness LUFS: " + value(input.sonicDna.loudnessLufs),
    "RMS energy: " + value(input.sonicDna.rmsEnergy),
    "Dynamic range dB: " + value(input.sonicDna.dynamicRangeDb),
    "Spectral centroid Hz: " + value(input.sonicDna.spectralCentroidHz),
    "Spectral bandwidth Hz: " + value(input.sonicDna.spectralBandwidthHz),
    "Spectral rolloff Hz: " + value(input.sonicDna.spectralRolloffHz),
    "Zero-crossing rate: " + value(input.sonicDna.zeroCrossingRate),
    "Mood tags: " + value(input.sonicDna.moodTags),
    "Genre context: " + value(input.sonicDna.genreContext),
  ];
}

function scoreLines(assessment: ArAssessment): string[] {
  const rows = [
    ["Sonic identity", assessment.scorecard.sonicIdentity],
    ["Metadata integrity", assessment.scorecard.metadataIntegrity],
    ["Commercial evidence", assessment.scorecard.commercialEvidence],
    ["Release readiness", assessment.scorecard.releaseReadiness],
  ] as const;
  return rows.flatMap(([name, item]) => [
    name + " score: " + (item.score === null ? "NOT SCORED" : String(item.score) + "/100"),
    "Rationale: " + item.rationale,
  ]);
}

function fullSections(input: AuditReportInput): Array<{ title: string; field: string; body: string[] }> {
  const a = input.assessment;
  return [
    {
      title: "01 | Executive assessment",
      field: "executive_summary",
      body: [a.executiveSummary, "Assessment confidence: " + Math.round(a.confidence * 100) + "%", "Evidence status: " + value(input.evidence.status)],
    },
    {
      title: "02 | Track identity and reconciliation",
      field: "track_identity",
      body: [
        "Artist: " + value(input.evidence.artist),
        "Title: " + value(input.evidence.title),
        "ISRC: " + value(input.evidence.isrc),
        "Album: " + value(input.evidence.album),
        "Release date: " + value(input.evidence.releaseDate),
        "Label: " + value(input.evidence.label),
        "Identity object: " + value(input.evidence.identity),
        "Reconciliation: " + value(input.evidence.reconciliation),
        "Source providers: " + value(input.evidence.sources ?? input.evidence.sourceProviders),
      ],
    },
    {
      title: "03 | Evidence ledger",
      field: "evidence_ledger",
      body: evidenceLabelLines(a).length ? evidenceLabelLines(a) : ["No individually labelled evidence claims were returned. Treat unlabelled statements as unverified until their sources are confirmed."],
    },
    {
      title: "04 | Sonic DNA and audio profile",
      field: "sonic_dna",
      body: sonicLines(input),
    },
    {
      title: "05 | Creative identity",
      field: "creative_identity",
      body: [a.creativeIdentity, "Primary A&R lane: " + a.aAndRPositioning.primaryLane, "Adjacent lanes: " + value(a.aAndRPositioning.adjacentLanes)],
    },
    {
      title: "06 | Strengths and creative leverage",
      field: "strengths",
      body: a.strengths,
    },
    {
      title: "07 | Risks and constraints",
      field: "risks",
      body: a.risks,
    },
    {
      title: "08 | A&R positioning rationale",
      field: "ar_positioning",
      body: ["Primary lane: " + a.aAndRPositioning.primaryLane, "Adjacent lanes: " + value(a.aAndRPositioning.adjacentLanes), a.aAndRPositioning.rationale],
    },
    {
      title: "09 | Evidence-based scorecard",
      field: "scorecard",
      body: scoreLines(a),
    },
    {
      title: "10 | Commercial read",
      field: "commercial_read",
      body: [
        "Marketability: " + a.commercialRead.marketability.toUpperCase(),
        a.commercialRead.rationale,
        "Catalog popularity: " + value(input.evidence.catalogPopularity),
        "Catalog popularity scale: " + value(input.evidence.catalogPopularityScale),
        "A catalog popularity indicator is not streams, revenue, sales, listener retention, or audience conversion.",
      ],
    },
    {
      title: "11 | Release strategy and priorities",
      field: "release_strategy",
      body: [a.releaseStrategy.recommendation, ...a.releaseStrategy.priorities.map((item, index) => "Priority " + (index + 1) + ": " + item)],
    },
    {
      title: "12 | Gaps, limitations and decision record",
      field: "limitations",
      body: [
        "Evidence gaps:",
        ...a.evidenceGaps,
        "Limitations:",
        ...a.limitations,
        "Decision boundary: do not treat inferred positioning as observed fact or metadata popularity as audience performance.",
      ],
    },
  ];
}

function sampleSections(input: AuditReportInput): Array<{ title: string; field: string; body: string[] }> {
  const a = input.assessment;
  return [
    {
      title: "Executive overview",
      field: "executive_summary",
      body: [
        "RESON8 | CONFIDENTIAL SAMPLE A&R AUDIT",
        value(input.evidence.artist) + " — " + value(input.evidence.title),
        "Audit ID: " + input.auditId + " | Generated: " + input.generatedAt.slice(0, 10),
        a.executiveSummary,
        "This sample is an initial evidence-led view, not a full campaign recommendation.",
      ],
    },
    {
      title: "Evidence snapshot",
      field: "evidence_snapshot",
      body: [
        "Identity status: " + value(input.evidence.status),
        "Artist: " + value(input.evidence.artist),
        "Title: " + value(input.evidence.title),
        "ISRC: " + value(input.evidence.isrc),
        ...sonicLines(input),
        ...evidenceLabelLines(a).slice(0, 4),
      ],
    },
    {
      title: "Preliminary A&R view",
      field: "ar_positioning",
      body: [
        a.creativeIdentity,
        "Primary lane: " + a.aAndRPositioning.primaryLane,
        "Positioning rationale: " + a.aAndRPositioning.rationale,
        "Strength signals:",
        ...a.strengths.slice(0, 3),
        "Risks to validate:",
        ...a.risks.slice(0, 2),
        "Evidence gaps:",
        ...a.evidenceGaps.slice(0, 3),
        "Limitations: " + a.limitations.join(" "),
        "Full scorecard, expanded risk analysis and release priorities are reserved for the full report.",
      ],
    },
  ];
}

export async function generateAuditReport(input: AuditReportInput, tier: AuditReportTier): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sections = tier === "sample" ? sampleSections(input) : fullSections(input);
  const maxPages = tier === "sample" ? 4 : 20;
  let pageNumber = 0;

  for (const section of sections) {
    if (pageNumber >= maxPages) break;
    pageNumber++;
    let page = pdf.addPage([612, 792]);
    drawPageHeader(page, section.title, pageNumber, font, bold);
    const paragraphs = section.body.length ? section.body : ["No evidence was supplied for this section."];
    let y = drawBody(page, paragraphs, font);

    if (section.field === "executive_summary" || section.field === "creative_identity" || section.field === "ar_positioning") {
      const fieldText = paragraphs.join("\n\n");
      addEditableField(pdf, page, font, section.field, fieldText, 350, 190);
    }

    let remaining = paragraphs.slice();
    while (y < 62 && remaining.length && pageNumber < maxPages) {
      pageNumber++;
      page = pdf.addPage([612, 792]);
      drawPageHeader(page, section.title + " | continued", pageNumber, font, bold);
      remaining = remaining.slice(1);
      y = drawBody(page, remaining, font);
    }
  }

  if (tier === "full") {
    while (pageNumber < 12) {
      pageNumber++;
      const page = pdf.addPage([612, 792]);
      drawPageHeader(page, "Evidence appendix " + (pageNumber - 11), pageNumber, font, bold);
      drawBody(page, [
        "Additional source material was not present in the supplied audit payload.",
        "No external audience, revenue, playlist, sales, or conversion data has been added to fill this gap.",
        "This page records an evidence limitation rather than manufacturing a conclusion.",
      ], font);
    }
  }

  const finalPage = pdf.getPages()[pdf.getPageCount() - 1];
  finalPage.drawText("Evidence before opinion. Inferences are labelled; missing evidence remains missing.", {
    x: 48, y: 44, size: 7, font, color: rgb(0.35, 0.37, 0.4),
  });

  return pdf.save();
}
