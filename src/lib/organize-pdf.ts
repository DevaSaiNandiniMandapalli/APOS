import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";
import { parsePageRanges } from "./split-pdf";

export type PageOperation = "delete" | "reorder" | "extract" | "duplicate" | "add-blank";
export type OrganizeOptions = { operation: PageOperation; pages?: string; blankCount?: number; afterPage?: number };

export async function organizePdfBuffer(bytes: Uint8Array, options: OrganizeOptions) {
  if (!bytes.byteLength) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let pageCount: number;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false }); pageCount = source.getPageCount(); }
  catch { throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);

  const output = await PDFDocument.create();
  let selected: number[] = [];
  let expectedPages = pageCount;
  let sourceIndices: number[];
  if (options.operation === "add-blank") {
    const blankCount = options.blankCount ?? 0;
    const afterPage = options.afterPage ?? -1;
    if (!Number.isInteger(blankCount) || blankCount < 1 || blankCount > 20) throw new PdfInputError("invalid-pages", "Add between 1 and 20 blank pages.");
    if (!Number.isInteger(afterPage) || afterPage < 0 || afterPage > pageCount) throw new PdfInputError("invalid-pages", `Insert position must be from 0 to ${pageCount}.`);
    expectedPages += blankCount;
    if (expectedPages > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The output cannot exceed ${PDF_LIMITS.pages} pages.`);
    const copies = await output.copyPages(source, source.getPageIndices());
    for (let position = 0; position <= pageCount; position += 1) {
      if (position === afterPage) {
        const reference = source.getPage(position === 0 ? 0 : position - 1).getSize();
        for (let count = 0; count < blankCount; count += 1) output.addPage([reference.width, reference.height]);
      }
      if (position < pageCount) output.addPage(copies[position]);
    }
  } else {
    try { selected = parsePageRanges(options.pages ?? "", pageCount).flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset - 1)); }
    catch (error) { throw new PdfInputError("invalid-pages", error instanceof Error ? error.message : "Enter valid page numbers or ranges."); }
    if (options.operation === "delete") {
      const removed = new Set(selected);
      sourceIndices = source.getPageIndices().filter((index) => !removed.has(index));
      if (!sourceIndices.length) throw new PdfInputError("invalid-pages", "At least one page must remain in the document.");
      expectedPages = sourceIndices.length;
    } else if (options.operation === "reorder") {
      if (selected.length !== pageCount) throw new PdfInputError("invalid-pages", `Enter every page from 1 to ${pageCount} exactly once to reorder this document.`);
      sourceIndices = selected;
    } else if (options.operation === "extract") {
      sourceIndices = selected;
      expectedPages = selected.length;
    } else {
      sourceIndices = [...source.getPageIndices(), ...selected];
      expectedPages = sourceIndices.length;
      if (expectedPages > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The output cannot exceed ${PDF_LIMITS.pages} pages.`);
    }
    const copied = await output.copyPages(source, sourceIndices);
    copied.forEach((page) => output.addPage(page));
  }

  const result = new Uint8Array(await output.save({ useObjectStreams: false }));
  try {
    const verified = await PDFDocument.load(result, { updateMetadata: false });
    if (verified.getPageCount() !== expectedPages || !checkPdfHeader(result)) throw new PdfInputError("invalid-pdf", "The organized PDF failed output validation.");
    return { bytes: result, pageCount: expectedPages };
  } catch (error) { result.fill(0); throw error; }
}
