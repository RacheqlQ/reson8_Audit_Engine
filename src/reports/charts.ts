import { rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export interface ChartRow {
  label: string;
  value: string | number | null | undefined;
  rationale?: string;
  proportion?: number | null;
}

export interface ChartPanelInput {
  title: string;
  rows: ChartRow[];
  shows: string;
  cantShow: string;
  inferred?: boolean;
  y?: number;
}

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.38, 0.41, 0.46);
const LINE = rgb(0.78, 0.8, 0.83);
const FILL = rgb(0.28, 0.42, 0.58);

function display(value: ChartRow["value"]): string {
  if (value === null || value === undefined || value === "") return "Not determined";
  if (typeof value === "number" && !Number.isFinite(value)) return "Not determined";
  return String(value);
}

function drawDashedState(page: PDFPage, x: number, y: number, width: number): void {
  for (let offset = 0; offset < width; offset += 7) {
    page.drawLine({ start: { x: x + offset, y }, end: { x: Math.min(x + offset + 3, x + width), y }, thickness: 1, color: LINE });
  }
}

export function drawChartPanel(
  page: PDFPage,
  input: ChartPanelInput,
  font: PDFFont,
  bold: PDFFont,
): void {
  const x = 48;
  const width = 516;
  const top = input.y ?? 250;
  const rows = input.rows.slice(0, 7);
  const rowHeight = rows.length > 4 ? 17 : 20;
  const panelHeight = Math.max(112, 70 + rows.length * rowHeight);
  const bottom = top - panelHeight;

  page.drawRectangle({ x, y: bottom, width, height: panelHeight, borderColor: LINE, borderWidth: 0.7, color: rgb(0.98, 0.985, 0.99) });
  page.drawText(input.title.toUpperCase(), { x: x + 10, y: top - 16, size: 8, font: bold, color: INK });
  if (input.inferred) {
    page.drawText("INFERRED", { x: x + width - 70, y: top - 16, size: 7, font: bold, color: MUTED });
  }

  let y = top - 34;
  for (const row of rows) {
    const label = row.label.slice(0, 25);
    page.drawText(label, { x: x + 10, y, size: 7, font, color: INK });
    const shown = display(row.value);
    if (shown === "Not determined") {
      drawDashedState(page, x + 166, y + 2, 112);
      page.drawText("Not determined", { x: x + 286, y, size: 7, font, color: MUTED });
    } else if (row.proportion !== undefined && row.proportion !== null && Number.isFinite(row.proportion)) {
      const ratio = Math.max(0, Math.min(1, row.proportion));
      page.drawRectangle({ x: x + 166, y: y - 1, width: 112, height: 6, color: rgb(0.9, 0.92, 0.94) });
      if (ratio > 0) page.drawRectangle({ x: x + 166, y: y - 1, width: 112 * ratio, height: 6, color: FILL });
      page.drawText(shown, { x: x + 286, y, size: 7, font, color: INK });
    } else {
      page.drawText(shown.slice(0, 38), { x: x + 166, y, size: 7, font, color: INK });
    }
    y -= rowHeight;
    if (row.rationale && y > bottom + 28) {
      page.drawText(("Rationale: " + row.rationale).slice(0, 92), { x: x + 22, y, size: 6, font, color: MUTED });
      y -= 10;
    }
  }

  const captionY = bottom + 9;
  page.drawText(("SHOWS: " + input.shows).slice(0, 102), { x: x + 10, y: captionY + 9, size: 6, font, color: MUTED });
  page.drawText(("CAN'T SHOW: " + input.cantShow).slice(0, 102), { x: x + 10, y: captionY, size: 6, font, color: MUTED });
}

export interface EvidenceLayerCounts {
  OBSERVED: number;
  RECOGNIZED: number;
  RECONCILED: number;
  INFERRED: number;
}

export function countEvidenceLayers(labels: Array<{ label: string }>): EvidenceLayerCounts {
  const counts: EvidenceLayerCounts = { OBSERVED: 0, RECOGNIZED: 0, RECONCILED: 0, INFERRED: 0 };
  for (const item of labels) {
    if (item.label in counts) counts[item.label as keyof EvidenceLayerCounts] += 1;
  }
  return counts;
}
