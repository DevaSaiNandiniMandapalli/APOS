import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type MergeProgress = { completed: number; total: number; label: string };

export async function mergePdfBuffers(
  inputs: Uint8Array[],
  onProgress?: (progress: MergeProgress) => void,
) {
  if (inputs.length < 2) throw new PdfInputError("too-few", "Select at least two PDF files.");
  if (inputs.length > PDF_LIMITS.fileCount) throw new PdfInputError("too-many", `Choose no more than ${PDF_LIMITS.fileCount} files.`);
  const totalBytes = inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (inputs.some((input) => input.byteLength === 0)) throw new PdfInputError("empty", "One of the selected files is empty.");
  if (inputs.some((input) => input.byteLength > PDF_LIMITS.perFileBytes) || totalBytes > PDF_LIMITS.totalBytes) throw new PdfInputError("too-large", "The selected files exceed the per-file or combined size limit.");

  const sources: PDFDocument[] = [];
  let pageCount = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    const bytes = inputs[index];
    if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "A selected file does not have a PDF signature.");
    let source: PDFDocument;
    let sourcePageCount: number;
    try {
      source = await PDFDocument.load(bytes, { updateMetadata: false });
      sourcePageCount = source.getPageCount();
    } catch {
      throw new PdfInputError("invalid-pdf", "A selected PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
    }
    if (sourcePageCount === 0) throw new PdfInputError("invalid-pdf", "A selected PDF has no pages.");
    pageCount += sourcePageCount;
    if (pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The merged document exceeds the ${PDF_LIMITS.pages}-page limit.`);
    sources.push(source);
    onProgress?.({ completed: index + 1, total: inputs.length, label: `Checked ${index + 1} of ${inputs.length} files` });
  }

  const output = await PDFDocument.create();
  for (let index = 0; index < sources.length; index += 1) {
    const pages = await output.copyPages(sources[index], sources[index].getPageIndices());
    for (const page of pages) output.addPage(page);
    onProgress?.({ completed: index + 1, total: sources.length, label: `Merged ${index + 1} of ${sources.length} files` });
  }

  const bytes = new Uint8Array(await output.save({ useObjectStreams: false }));
  if (bytes.byteLength > PDF_LIMITS.mergeOutputBytes) {
    bytes.fill(0);
    throw new PdfInputError("too-large", `The merged PDF exceeds the ${PDF_LIMITS.mergeOutputBytes / 1024 / 1024} MB output limit.`);
  }
  try {
    const verified = await PDFDocument.load(bytes, { updateMetadata: false });
    if (verified.getPageCount() !== pageCount || !checkPdfHeader(bytes)) throw new PdfInputError("invalid-pdf", "The generated document failed output validation.");
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
  return { bytes, pageCount };
}
