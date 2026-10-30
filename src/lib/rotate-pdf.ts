import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";
import type { PageRange } from "./split-pdf";

export async function rotatePdfBuffer(bytes: Uint8Array, ranges: PageRange[], angle: 90 | 180 | 270, rotateAll = false) {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let pageCount: number;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false }); pageCount = source.getPageCount(); }
  catch { throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const selected = new Set<number>();
  if (rotateAll) for (let page = 0; page < pageCount; page += 1) selected.add(page);
  else for (const range of ranges) {
    if (range.first < 1 || range.last < range.first || range.last > pageCount) throw new PdfInputError("invalid-pages", `Page selection must stay within 1-${pageCount}.`);
    for (let page = range.first; page <= range.last; page += 1) selected.add(page - 1);
  }
  if (!selected.size) throw new PdfInputError("invalid-pages", "Select at least one page to rotate.");
  const pages = source.getPages();
  pages.forEach((page, index) => {
    if (selected.has(index)) page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  const output = new Uint8Array(await source.save({ useObjectStreams: false }));
  try {
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    if (verified.getPageCount() !== pageCount || !checkPdfHeader(output)) throw new PdfInputError("invalid-pdf", "The rotated PDF failed output validation.");
    verified.getPages().forEach((page, index) => {
      const expected = selected.has(index) ? (pages[index].getRotation().angle % 360) : pages[index].getRotation().angle;
      if (page.getRotation().angle !== expected) throw new PdfInputError("invalid-pdf", "The rotated PDF failed orientation validation.");
    });
    return { bytes: output, pageCount };
  } catch (error) {
    output.fill(0);
    throw error;
  }
}
