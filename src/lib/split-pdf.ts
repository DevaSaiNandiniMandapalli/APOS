import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type PageRange = { first: number; last: number };
export type SplitProgress = { completed: number; total: number; label: string };

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
  assertNoOverlaps(ranges);
  return ranges;
}

export function assertNoOverlaps(ranges: PageRange[]) {
  const seen = new Set<number>();
  for (const range of ranges) {
    if (!Number.isInteger(range.first) || !Number.isInteger(range.last) || range.first < 1 || range.last < range.first) {
      throw new PdfInputError("invalid-pages", "Page ranges must use positive whole page numbers in ascending order.");
    }
    for (let page = range.first; page <= range.last; page += 1) {
      if (seen.has(page)) throw new PdfInputError("invalid-pages", "Page ranges cannot overlap.");
      seen.add(page);
    }
  }
}

export function pagesToRanges(pages: Iterable<number>): PageRange[] {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: PageRange[] = [];
  for (const page of sorted) {
    if (!Number.isInteger(page) || page < 1) throw new PdfInputError("invalid-pages", "Page numbers must be positive whole numbers.");
    const current = ranges[ranges.length - 1];
    if (current && page === current.last + 1) current.last = page;
    else ranges.push({ first: page, last: page });
  }
  return ranges;
}

export function formatPageRanges(ranges: PageRange[]): string {
  return ranges.map((range) => range.first === range.last ? String(range.first) : `${range.first}-${range.last}`).join(", ");
}

export function buildEveryPageRanges(pageCount: number): PageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("invalid-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  return Array.from({ length: pageCount }, (_, index) => ({ first: index + 1, last: index + 1 }));
}

export function buildEqualRanges(pageCount: number, pagesPerFile: number): PageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("invalid-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1 || pagesPerFile > pageCount) throw new PdfInputError("invalid-pages", `Choose between 1 and ${pageCount} pages per file.`);
  const ranges: PageRange[] = [];
  for (let first = 1; first <= pageCount; first += pagesPerFile) {
    ranges.push({ first, last: Math.min(pageCount, first + pagesPerFile - 1) });
  }
  if (ranges.length > PDF_LIMITS.splitOutputs) throw new PdfInputError("too-many-outputs", `Create no more than ${PDF_LIMITS.splitOutputs} output files at once.`);
  return ranges;
}

async function loadSplitSource(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let count: number;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    count = source.getPageCount();
  } catch {
    throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
  }
  if (count < 1 || count > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  return { source, count };
}

export async function extractPdfPages(
  bytes: Uint8Array,
  pages: number[],
  onProgress?: (progress: SplitProgress) => void,
) {
  if (!pages.length) throw new PdfInputError("invalid-pages", "Select at least one page.");
  if (new Set(pages).size !== pages.length) throw new PdfInputError("invalid-pages", "Selected pages cannot contain duplicates.");
  const { source, count } = await loadSplitSource(bytes);
  const ordered = [...pages].sort((left, right) => left - right);
  if (ordered.some((page) => !Number.isInteger(page) || page < 1 || page > count)) {
    throw new PdfInputError("invalid-pages", "A selected page is outside this document.");
  }
  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, ordered.map((page) => page - 1));
  copied.forEach((page) => output.addPage(page));
  onProgress?.({ completed: ordered.length, total: ordered.length, label: `Extracted ${ordered.length} page${ordered.length === 1 ? "" : "s"}` });
  const result = new Uint8Array(await output.save({ useObjectStreams: false }));
  if (result.byteLength > PDF_LIMITS.perFileBytes) {
    result.fill(0);
    throw new PdfInputError("too-large", "The extracted PDF exceeds the 50 MB output limit.");
  }
  try {
    const checked = await PDFDocument.load(result, { updateMetadata: false });
    if (checked.getPageCount() !== ordered.length || !checkPdfHeader(result)) throw new PdfInputError("invalid-pdf", "The extracted PDF failed output validation.");
  } catch (error) {
    result.fill(0);
    throw error;
  }
  return { bytes: result, pageCount: ordered.length };
}

export async function splitPdfBuffer(
  bytes: Uint8Array,
  ranges: PageRange[],
  onProgress?: (progress: SplitProgress) => void,
) {
  if (!ranges.length) throw new PdfInputError("invalid-pages", "Select at least one page range.");
  if (ranges.length > PDF_LIMITS.splitOutputs) throw new PdfInputError("too-many-outputs", `Create no more than ${PDF_LIMITS.splitOutputs} output files at once.`);
  assertNoOverlaps(ranges);
  const { source, count } = await loadSplitSource(bytes);
  const outputs: Uint8Array[] = [];
  let totalOutputBytes = 0;
  try {
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      if (range.first < 1 || range.last < range.first || range.last > count) throw new PdfInputError("invalid-pages", "A requested page range is outside this document.");
      const output = await PDFDocument.create();
      const indices = Array.from({ length: range.last - range.first + 1 }, (_, offset) => range.first + offset - 1);
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
      onProgress?.({ completed: index + 1, total: ranges.length, label: `Created range ${index + 1} of ${ranges.length}` });
    }
  } catch (error) {
    outputs.forEach((output) => output.fill(0));
    throw error;
  }
  return outputs;
}
