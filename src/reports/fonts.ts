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
const fontBytes = (file: string) => readFile(new URL(FONT_ROOT + file, import.meta.url));

export async function loadReportFonts(pdf: PDFDocument): Promise<ReportFonts> {
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes, italicBytes, boldItalicBytes] = await Promise.all([
    fontBytes("ibm-plex-sans-latin-400-normal.woff2"),
    fontBytes("ibm-plex-sans-latin-700-normal.woff2"),
    fontBytes("ibm-plex-sans-latin-400-italic.woff2"),
    fontBytes("ibm-plex-sans-latin-700-italic.woff2"),
  ]);
  const [regular, bold, italic, boldItalic] = await Promise.all([
    pdf.embedFont(regularBytes),
    pdf.embedFont(boldBytes),
    pdf.embedFont(italicBytes),
    pdf.embedFont(boldItalicBytes),
  ]);
  return { regular, bold, italic, boldItalic };
}
