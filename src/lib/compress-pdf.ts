import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export function compressionSizeReport(inputBytes: number, outputBytes: number) {
  const change = inputBytes - outputBytes;
  if (change === 0) return "No size reduction: the rewritten PDF is the same size.";
  const format = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return change > 0
    ? `Reduced by ${format(change)} (${((change / inputBytes) * 100).toFixed(1)}%).`
    : `No size reduction: the output is ${format(Math.abs(change))} larger.`;
}

export async function compressPdfBuffer(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let pageSizes: Array<{ width: number; height: number }>;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    if (source.getPageCount() < 1 || source.getPageCount() > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
    pageSizes = source.getPages().map((page) => page.getSize());
  } catch (error) {
    if (error instanceof PdfInputError) throw error;
    throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
  }
  const output = new Uint8Array(await source.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The rewritten PDF exceeds the 50 MB output limit.");
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    const actualSizes = verified.getPages().map((page) => page.getSize());
    if (!checkPdfHeader(output) || verified.getPageCount() !== pageSizes.length || actualSizes.some((size, index) => size.width !== pageSizes[index].width || size.height !== pageSizes[index].height)) {
      throw new PdfInputError("invalid-pdf", "The rewritten PDF failed output validation.");
    }
    return { bytes: output, inputBytes: bytes.byteLength, outputBytes: output.byteLength, pageCount: pageSizes.length };
  } catch (error) { output.fill(0); throw error; }
}
