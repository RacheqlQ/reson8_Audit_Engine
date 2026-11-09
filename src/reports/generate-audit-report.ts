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
): void {
  const field = pdf.getForm().createTextField(name);
  field.enableMultiline();
  field.setText(content.slice(0, 8000));
  field.addToPage(page, { x: 48, y: 105, width: 516, height: 42 });
  field.setFontSize(9);
  field.updateAppearances(font);
}

function drawPageHeader(page: PDFPage, title: string, pageNumber: number, font: PDFFont, bold: PDFFont): void {
  page.drawText("RESON8 | A&R INTELLIGENCE", { x: 48, y: 754, size: 8, font: bold, color: rgb(0.25, 0.28, 0.33) });
  page.drawText(title, { x: 48, y: 716, size: 19, font: bold, color: rgb(0.05, 0.07, 0.1) });
  page.drawText("PRIVATE AUDIT | " + pageNumber, { x: 490, y: 28, size: 7, font, color: rgb(0.35, 0.37, 0.4) });
}

function drawBody(
  page: PDFPage,
  paragraphs: string[],
  font: PDFFont,
  startY = 680,
  startParagraph = 0,
  startLine = 0,
): { paragraph: number; line: number; y: number } {
  let y = startY;
  for (let paragraphIndex = startParagraph; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const lines = wrap(paragraphs[paragraphIndex]);
    const firstLine = paragraphIndex === startParagraph ? startLine : 0;
    for (let lineIndex = firstLine; lineIndex < lines.length; lineIndex++) {
      if (y < 62) return { paragraph: paragraphIndex, line: lineIndex, y };
      page.drawText(lines[lineIndex], { x: 48, y, size: 9, font, color: rgb(0.12, 0.14, 0.17) });
      y -= 14;
    }
    y -= 10;
  }
  return { paragraph: paragraphs.length, line: 0, y };
}

function auditLabel(input: AuditReportInput): string {
  if (input.evidence.auditType === "METADATA-BASED AUDIT" || input.sonicDna?.provenance === "tidal_catalog_metadata") {
    return "METADATA-BASED AUDIT";
  }
  return "MASTER-BASED AUDIT";
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
  const evidence = input.evidence;
  const sonic = sonicLines(input);
  return [
    {
      title: "01 | Executive assessment",
      field: "executive_summary",
      body: [auditLabel(input), a.executiveSummary, "Assessment confidence: " + Math.round(a.confidence * 100) + "%", "Evidence status: " + value(evidence.status), "This assessment distinguishes supplied observations, recognized identity, reconciled metadata and interpretive A&R hypotheses."],
    },
    {
      title: "02 | Track identity and source reconciliation",
      field: "track_identity",
      body: [
        "Artist: " + value(evidence.artist),
        "Title: " + value(evidence.title),
        "ISRC: " + value(evidence.isrc),
        "Album: " + value(evidence.album),
        "Release date: " + value(evidence.releaseDate),
        "Label: " + value(evidence.label),
        "Identity object: " + value(evidence.identity),
        "Reconciliation record: " + value(evidence.reconciliation),
        "Source providers: " + value(evidence.sources ?? evidence.sourceProviders),
        "Identity fields should be checked against the distributor's release record before pitching or campaign setup.",
      ],
    },
    {
      title: "03 | Evidence ledger and provenance",
      field: "evidence_ledger",
      body: evidenceLabelLines(a).length ? evidenceLabelLines(a) : ["No individually labelled evidence claims were returned. Treat unlabelled statements as unverified until their sources are confirmed."],
    },
    {
      title: "04 | Sonic DNA and audio profile",
      field: "sonic_dna",
      body: [
        ...sonic,
        "Interpretation boundary: provider catalog fields are not equivalent to measurements extracted from an uploaded master.",
        "A final production assessment requires listening to the complete approved master, including its vocal, arrangement and mix context.",
      ],
    },
    {
      title: "05 | Creative identity and artistic proposition",
      field: "creative_identity",
      body: [
        a.creativeIdentity,
        "Primary A&R lane: " + a.aAndRPositioning.primaryLane,
        "Adjacent lanes: " + value(a.aAndRPositioning.adjacentLanes),
        "The lane is a working discovery hypothesis. It should be tested against the complete recording, artist catalogue and intended release context.",
      ],
    },
    {
      title: "06 | Strengths and creative leverage",
      field: "strengths",
      body: [
        ...a.strengths,
        "A strength is actionable only when it can be tied to a source, a listening observation or a clearly stated creative interpretation.",
        "Use these points to shape the artist narrative; do not convert them into unsupported claims about audience size or commercial traction.",
      ],
    },
    {
      title: "07 | Risks, constraints and diligence",
      field: "risks",
      body: [
        ...a.risks,
        "Confirm rights, contributor credits, release metadata and asset ownership through the relevant primary records.",
        "Resolve missing evidence before making claims to a label, distributor, media contact or curator.",
      ],
    },
    {
      title: "08 | A&R positioning rationale",
      field: "ar_positioning",
      body: [
        "Primary lane: " + a.aAndRPositioning.primaryLane,
        "Adjacent lanes: " + value(a.aAndRPositioning.adjacentLanes),
        a.aAndRPositioning.rationale,
        "Positioning should remain specific to the recording rather than relying on broad genre labels alone.",
        "The final pitch should explain the track's musical identity, artist context and reason for release now, with unsupported comparisons removed.",
      ],
    },
    {
      title: "09 | Evidence-based scorecard",
      field: "scorecard",
      body: [
        ...scoreLines(a),
        "Scores describe the completeness and usefulness of the supplied evidence. They are not a prediction of streaming outcomes, signing decisions or listener response.",
      ],
    },
    {
      title: "10 | Commercial evidence and marketability",
      field: "commercial_read",
      body: [
        "Marketability: " + a.commercialRead.marketability.toUpperCase(),
        a.commercialRead.rationale,
        "Catalog popularity: " + value(evidence.catalogPopularity),
        "Catalog popularity scale: " + value(evidence.catalogPopularityScale),
        "A catalog popularity indicator is not streams, revenue, sales, listener retention, playlist conversion or proof of demand.",
        "No commercial conclusion should be upgraded until platform analytics and campaign outcomes are supplied with their reporting period and source.",
      ],
    },
    {
      title: "11 | Audience evidence and validation plan",
      field: "audience_evidence",
      body: [
        "Verified audience telemetry supplied: " + value(evidence.audienceTelemetry),
        "Audience segments or demographics supplied: " + value(evidence.audienceSegments),
        "Listener retention or completion evidence supplied: " + value(evidence.listenerRetention),
        "The current evidence does not establish audience demographics, geographic concentration, listener loyalty or conversion behaviour.",
        "Validation plan: collect platform-native audience geography, returning-listener behaviour, saves, completion and follower conversion after the release has measurable exposure.",
        "Keep the source platform, date range, sample size and definition attached to every metric before using it in an A&R decision.",
      ],
    },
    {
      title: "12 | DSP and curator discovery readiness",
      field: "curator_readiness",
      body: [
        "No named curator, playlist placement or editorial relationship is asserted by this report unless an independently verified source is present in the evidence.",
        "Build a target shortlist only after confirming the track's sound, clean metadata, release timing, rights status and fit with each outlet's published submission criteria.",
        "Prioritize genuine stylistic fit and current activity over follower counts or unverified placement promises.",
        "Record the source, contact route, submission requirements, last verification date and response outcome for every future target.",
        "Do not treat a suggested target category as an existing relationship or a guaranteed placement.",
      ],
    },
    {
      title: "13 | Release strategy and priorities",
      field: "release_strategy",
      body: [
        a.releaseStrategy.recommendation,
        ...a.releaseStrategy.priorities.map((item, index) => "Priority " + (index + 1) + ": " + item),
        "Sequence execution around confirmed assets and evidence. Do not commit campaign spend against unverified reach assumptions.",
      ],
    },
    {
      title: "14 | Campaign measurement framework",
      field: "campaign_measurement",
      body: [
        "Before launch, record the baseline and the exact reporting window for each connected DSP and social platform.",
        "Track qualified reach, listener conversion, saves, repeat listening, completion, follower change and attributable traffic where the platform exposes those measures.",
        "Separate organic response from paid exposure and identify campaign actions that can reasonably explain a change.",
        "Compare like-for-like periods and retain the raw source export so later A&R decisions can be audited.",
        "No forecast or target value is inserted here because no verified baseline was supplied.",
      ],
    },
    {
      title: "15 | Operational readiness and asset checklist",
      field: "operational_readiness",
      body: [
        "Confirm final master, clean and explicit versions where applicable, artwork, artist and contributor credits, ISRC, release date, label and distributor delivery status.",
        "Confirm that all contributors, samples and visual assets have the permissions required for the intended release and promotional use.",
        "Prepare a concise track description that matches the final recording and does not overstate the available audience evidence.",
        "Keep the final metadata, approved assets and campaign links in one version-controlled release record.",
        "Items not present in the supplied evidence remain open checks, not assumed approvals.",
      ],
    },
    {
      title: "16 | Evidence gaps, limitations and decision record",
      field: "limitations",
      body: [
        "Evidence gaps:",
        ...a.evidenceGaps,
        "Limitations:",
        ...a.limitations,
        "Decision boundary: do not treat inferred positioning as observed fact or metadata popularity as audience performance.",
        "Next decision gate: update this assessment only when the missing source material is supplied and independently reconciled.",
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
        "SAMPLE / PREVIEW — NOT A FULL CAMPAIGN REPORT",
        "RESON8 | CONFIDENTIAL SAMPLE A&R AUDIT",
        auditLabel(input),
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

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    if (pageNumber >= maxPages) break;
    pageNumber++;
    let page = pdf.addPage([612, 792]);
    drawPageHeader(page, tier === "sample" ? "SAMPLE / PREVIEW | " + section.title : section.title, pageNumber, font, bold);
    const paragraphs = section.body.length ? section.body : ["No evidence was supplied for this section."];
    let position = drawBody(page, paragraphs, font);

    if (section.field === "executive_summary" || section.field === "creative_identity" || section.field === "ar_positioning") {
      const fieldText = paragraphs.join("\n\n");
      addEditableField(pdf, page, font, section.field, fieldText, 350, 190);
    }

    while (position.paragraph < paragraphs.length && pageNumber < maxPages - (sections.length - sectionIndex - 1)) {
      pageNumber++;
      page = pdf.addPage([612, 792]);
      drawPageHeader(page, (tier === "sample" ? "SAMPLE / PREVIEW | " : "") + section.title + " | continued", pageNumber, font, bold);
      position = drawBody(page, paragraphs, font, 680, position.paragraph, position.line);
    }
  }

  const finalPage = pdf.getPages()[pdf.getPageCount() - 1];
  finalPage.drawText("Evidence before opinion. Inferences are labelled; missing evidence remains missing.", {
    x: 48, y: 44, size: 7, font, color: rgb(0.35, 0.37, 0.4),
  });

  return pdf.save();
}
