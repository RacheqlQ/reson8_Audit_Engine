import { StandardFonts, type PDFFont, type PDFDocument } from "@cantoo/pdf-lib";

export interface ReportFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

export function loadReportFonts(pdf: PDFDocument): ReportFonts {
  return {
    regular: pdf.embedFont(StandardFonts.Helvetica),
    bold: pdf.embedFont(StandardFonts.HelveticaBold),
    italic: pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
}
