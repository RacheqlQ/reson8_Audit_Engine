import { StandardFonts, type PDFFont, type PDFDocument } from "@cantoo/pdf-lib";

export interface ReportFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

export async function loadReportFonts(pdf: PDFDocument): Promise<ReportFonts> {
  const [regular,bold,italic,boldItalic]=await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  ]);
  return {regular,bold,italic,boldItalic};
}
