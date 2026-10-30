import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type PageRange = { first: number; last: number };

export function parsePageRanges(value: string, pageCount: number): PageRange[] {
  const pieces = value.split(",").map((part) => part.trim());
  if (!pieces.length || pieces.some((part) => !part)) throw new PdfInputError("invalid-pages", "Enter page numbers or ranges such as 1-3, 5.");
  const ranges = pieces.map((part) => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new PdfInputError("invalid-pages", "Use page numbers or ranges such as 1-3, 5.");
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > pageCount) throw new PdfInputError("invalid-pages", `Page range ${part} is outside this document's 1-${pageCount} pages.`);
    return { first, last };
  });
  const seen = new Set<number>();
  for (const range of ranges) for (let page = range.first; page <= range.last; page += 1) {
    if (seen.has(page)) throw new PdfInputError("invalid-pages", "Page ranges cannot overlap.");
    seen.add(page);
  }
  return ranges;
}

export async function splitPdfBuffer(bytes: Uint8Array, ranges: PageRange[]) {
  if (!ranges.length) throw new PdfInputError("invalid-pages", "Select at least one page range.");
  if (ranges.length > PDF_LIMITS.splitOutputs) throw new PdfInputError("too-many-outputs", `Create no more than ${PDF_LIMITS.splitOutputs} output files at once.`);
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let count: number;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false }); count = source.getPageCount(); }
  catch { throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
  if (count < 1 || count > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const outputs: Uint8Array[] = [];
  let totalOutputBytes = 0;
  try { for (const range of ranges) {
    if (range.first < 1 || range.last < range.first || range.last > count) throw new PdfInputError("invalid-pages", "A requested page range is outside this document.");
    const output = await PDFDocument.create();
    const indices = Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index - 1);
    const copied = await output.copyPages(source, indices);
    copied.forEach((page) => output.addPage(page));
    const result = new Uint8Array(await output.save({ useObjectStreams: false }));
    let checkedCount: number;
    try { checkedCount = (await PDFDocument.load(result, { updateMetadata: false })).getPageCount(); }
    catch { result.fill(0); throw new PdfInputError("invalid-pdf", "A split output failed validation."); }
    if (checkedCount !== indices.length || !checkPdfHeader(result)) { result.fill(0); throw new PdfInputError("invalid-pdf", "A split output failed validation."); }
    if (result.byteLength > PDF_LIMITS.perFileBytes || totalOutputBytes + result.byteLength > PDF_LIMITS.splitTotalBytes) {
      result.fill(0);
      throw new PdfInputError("too-large", "Split outputs exceed the per-file or combined 100 MB limit.");
    }
    totalOutputBytes += result.byteLength;
    outputs.push(result);
  } } catch (error) { outputs.forEach((output) => output.fill(0)); throw error; }
  return outputs;
}
