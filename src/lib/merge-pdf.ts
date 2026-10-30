import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export async function mergePdfBuffers(inputs: Uint8Array[]) {
  if (inputs.length < 2) throw new PdfInputError("too-few", "Select at least two PDF files.");
  if (inputs.length > PDF_LIMITS.fileCount) throw new PdfInputError("too-many", `Choose no more than ${PDF_LIMITS.fileCount} files.`);
  const totalBytes = inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (inputs.some((input) => input.byteLength === 0)) throw new PdfInputError("empty", "One of the selected files is empty.");
  if (inputs.some((input) => input.byteLength > PDF_LIMITS.perFileBytes) || totalBytes > PDF_LIMITS.totalBytes) throw new PdfInputError("too-large", "The selected files exceed the per-file or combined size limit.");

  const output = await PDFDocument.create();
  let pageCount = 0;
  for (const bytes of inputs) {
    if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "A selected file does not have a PDF signature.");
    let source: PDFDocument;
    let sourcePageCount: number;
    try { source = await PDFDocument.load(bytes, { updateMetadata: false }); sourcePageCount = source.getPageCount(); }
    catch { throw new PdfInputError("invalid-pdf", "A selected PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
    if (sourcePageCount === 0) throw new PdfInputError("invalid-pdf", "A selected PDF has no pages.");
    pageCount += sourcePageCount;
    if (pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The merged document exceeds the ${PDF_LIMITS.pages}-page limit.`);
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) output.addPage(page);
  }
  const bytes = await output.save({ useObjectStreams: false });
  const verified = await PDFDocument.load(bytes, { updateMetadata: false });
  if (verified.getPageCount() !== pageCount || !checkPdfHeader(bytes)) throw new PdfInputError("invalid-pdf", "The generated document failed output validation.");
  return { bytes, pageCount };
}
