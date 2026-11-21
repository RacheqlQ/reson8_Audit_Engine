import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import type { PDFFont, PDFDocument } from "@cantoo/pdf-lib";

export interface ReportFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

const FONT_ROOT = "../../node_modules/@fontsource/ibm-plex-sans/files/";
const fontCache = new Map<string, Promise<Uint8Array>>();
function fontBytes(file: string): Promise<Uint8Array> {
  let cached = fontCache.get(file);
  if (!cached) {
    cached = readFile(new URL(FONT_ROOT + file, import.meta.url));
    fontCache.set(file, cached);
  }
  return cached;
}

export async function loadReportFonts(pdf: PDFDocument): Promise<ReportFonts> {
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    fontBytes("ibm-plex-sans-latin-400-normal.woff2"),
    fontBytes("ibm-plex-sans-latin-700-normal.woff2"),
  ]);
  const [regular, bold] = await Promise.all([
    pdf.embedFont(regularBytes),
    pdf.embedFont(boldBytes),
  ]);
  // Reuse the two embedded families for italic roles. This avoids parsing and
  // embedding four near-identical font files for every generated report.
  return { regular, bold, italic: regular, boldItalic: bold };
}
