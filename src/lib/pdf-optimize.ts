import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type OptimizeOptions = {
  compressStreams: boolean;
  removeMetadata: boolean;
  flattenForms: boolean;
};

export const DEFAULT_OPTIMIZE_OPTIONS: OptimizeOptions = { compressStreams: true, removeMetadata: false, flattenForms: false };

export type OptimizeReport = {
  inputBytes: number;
  outputBytes: number;
  savedBytes: number;
  savedPercent: number;
  pageCount: number;
  metadataCleared: string[];
  fieldsFlattened: number;
  notes: string[];
  verified: boolean;
};

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function optimizeSummary(report: OptimizeReport) {
  if (report.savedBytes > 0) return `Saved ${formatBytes(report.savedBytes)} (${report.savedPercent.toFixed(1)}% smaller).`;
  if (report.savedBytes === 0) return "The rewritten PDF is the same size.";
  return `No size reduction: the output is ${formatBytes(Math.abs(report.savedBytes))} larger.`;
}

export async function optimizePdfBuffer(bytes: Uint8Array, options: OptimizeOptions): Promise<{ bytes: Uint8Array; report: OptimizeReport }> {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
  }
  const pageCount = source.getPageCount();
  if (pageCount < 1) throw new PdfInputError("invalid-pdf", "No pages could be read from this document.");
  if (pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const pageSizes = source.getPages().map((page) => page.getSize());

  const notes: string[] = [];
  const metadataCleared: string[] = [];
  let fieldsFlattened = 0;

  if (options.removeMetadata) {
    const entries: Array<[string, () => string | undefined, () => void]> = [
      ["Title", () => source.getTitle(), () => source.setTitle("")],
      ["Author", () => source.getAuthor(), () => source.setAuthor("")],
      ["Subject", () => source.getSubject(), () => source.setSubject("")],
      ["Keywords", () => source.getKeywords(), () => source.setKeywords([])],
      ["Creator", () => source.getCreator(), () => source.setCreator("")],
    ];
    for (const [key, read, clear] of entries) {
      let current: string | undefined;
      try { current = read(); } catch { current = undefined; }
      if (current && current.trim()) { clear(); metadataCleared.push(key); }
    }
    source.setProducer("");
  }

  if (options.flattenForms) {
    try {
      const form = source.getForm();
      const fieldCount = form.getFields().length;
      form.flatten();
      fieldsFlattened = fieldCount;
      if (fieldCount === 0) notes.push("No fillable form fields were found; the appearance is unchanged.");
    } catch {
      notes.push("Form fields could not be flattened because the form structure is damaged. The rest of the document was still optimized.");
    }
  }

  const output = new Uint8Array(await source.save({ useObjectStreams: options.compressStreams, updateFieldAppearances: !options.flattenForms }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The optimized PDF exceeds the 50 MB output limit.");
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    const actualSizes = verified.getPages().map((page) => page.getSize());
    const sizesMatch = actualSizes.length === pageSizes.length
      && actualSizes.every((size, index) => size.width === pageSizes[index].width && size.height === pageSizes[index].height);
    if (!checkPdfHeader(output) || verified.getPageCount() !== pageCount || !sizesMatch) {
      throw new PdfInputError("invalid-pdf", "The optimized PDF failed validation and was discarded.");
    }
    const savedBytes = bytes.byteLength - output.byteLength;
    return {
      bytes: output,
      report: {
        inputBytes: bytes.byteLength,
        outputBytes: output.byteLength,
        savedBytes,
        savedPercent: bytes.byteLength ? (savedBytes / bytes.byteLength) * 100 : 0,
        pageCount,
        metadataCleared,
        fieldsFlattened,
        notes,
        verified: true,
      },
    };
  } catch (error) { output.fill(0); throw error; }
}
