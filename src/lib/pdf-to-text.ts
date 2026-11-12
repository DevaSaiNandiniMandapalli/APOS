import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { unzipSync } from "fflate";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { CONVERSION_LIMITS, validateHtmlOutput, validatePlainTextOutput } from "./conversion-engine";
import { resolvePageSelection } from "./pdf-page-selection";

export type PdfTextDocument = Pick<PDFDocumentProxy, "numPages" | "getPage">;
export type PdfTextPage = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export type PdfTextItem = { str: string; hasEOL?: boolean } | { type: string };
export type PdfTextProgress = { completedPages: number; totalPages: number };

export type PdfTextSettings = {
  includePageLabels: boolean;
  pages?: string;
  title?: string;
  layout?: "reading" | "layout";
  includePictures?: boolean;
  includeTables?: boolean;
};

export async function extractPdfDocumentText(
  document: PdfTextDocument,
  settings: PdfTextSettings,
  signal: AbortSignal,
  onProgress: (progress: PdfTextProgress) => void,
) {
  if (document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error(`PDF files must contain 1-${PDF_LIMITS.pages} pages.`);
  const selectedPages = resolvePageSelection(settings.pages, document.numPages);
  const pages: string[] = [];
  const pageTexts: string[] = [];
  const emptyPages: number[] = [];
  onProgress({ completedPages: 0, totalPages: selectedPages.length });
  for (let position = 0; position < selectedPages.length; position += 1) {
    if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const pageNumber = selectedPages[position];
    try {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item: PdfTextItem) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+\n/g, "\n").trim();
      pageTexts.push(text);
      if (!text) emptyPages.push(pageNumber);
      const section = settings.includePageLabels ? `--- Page ${pageNumber} ---${text ? `\n${text}` : ""}` : text;
      pages.push(section);
      page.cleanup();
      const measured = pages.join("\n\n").length;
      if (measured > CONVERSION_LIMITS.outputCharacters) throw new Error("Extracted text exceeds the 20 MB output limit. Use fewer or smaller PDFs.");
      onProgress({ completedPages: position + 1, totalPages: selectedPages.length });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new DOMException("Conversion cancelled", "AbortError");
      if (error instanceof Error && error.message.includes("20 MB output limit")) throw error;
      throw new Error(`Page ${pageNumber} text could not be extracted. The PDF may contain unsupported or damaged page content.`);
    }
  }
  const output = pages.join("\n\n");
  const bytes = new TextEncoder().encode(output);
  validatePlainTextOutput(bytes);
  return {
    bytes,
    pageCount: selectedPages.length,
    totalPages: document.numPages,
    selectedPages,
    emptyPages,
    pageTexts,
    characterCount: output.length,
  };
}

export async function convertPdfFileToText(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  settings: PdfTextSettings,
  signal: AbortSignal,
  onProgress: (progress: PdfTextProgress) => void,
) {
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > CONVERSION_LIMITS.inputFileBytes) throw new Error("PDF to text accepts files up to 25 MB each.");
  let input: Uint8Array | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    const buffer = await file.arrayBuffer();
    if (signal.aborted) { new Uint8Array(buffer).fill(0); throw new DOMException("Conversion cancelled", "AbortError"); }
    input = new Uint8Array(buffer);
    if (!checkPdfHeader(input.subarray(0, 1024))) throw new Error("The selected file does not have a PDF signature.");
    const pdfjs = await import("pdfjs-dist");
    if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    loadingTask = pdfjs.getDocument({ data: input });
    abortHandler = () => { if (loadingTask) void loadingTask.destroy(); };
    signal.addEventListener("abort", abortHandler, { once: true });
    let document: PDFDocumentProxy;
    try { document = await loadingTask.promise; }
    catch { if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError"); throw new Error("The PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
    if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const result = await extractPdfDocumentText(document, settings, signal, onProgress);
    if (result.emptyPages.length === result.pageCount) {
      result.bytes.fill(0);
      throw new Error("No selectable text was found in the selected pages. This PDF may be scanned or image-only; run OCR PDF first if you need recognised text.");
    }
    return result;
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    if (input?.byteLength) input.fill(0);
    if (loadingTask) { try { await loadingTask.destroy(); } catch { /* PDF.js may already have destroyed a cancelled task. */ } }
  }
}

export async function convertPdfFileToHtml(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  settings: PdfTextSettings,
  signal: AbortSignal,
  onProgress: (progress: PdfTextProgress) => void,
) {
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > CONVERSION_LIMITS.inputFileBytes) throw new Error("PDF to HTML accepts files up to 25 MB each.");
  let input: Uint8Array | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    const buffer = await file.arrayBuffer();
    if (signal.aborted) { new Uint8Array(buffer).fill(0); throw new DOMException("Conversion cancelled", "AbortError"); }
    input = new Uint8Array(buffer);
    if (!checkPdfHeader(input.subarray(0, 1024))) throw new Error("The selected file does not have a PDF signature.");
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    loadingTask = pdfjs.getDocument({ data: input });
    abortHandler = () => { if (loadingTask) void loadingTask.destroy(); };
    signal.addEventListener("abort", abortHandler, { once: true });
    let document: PDFDocumentProxy;
    try { document = await loadingTask.promise; }
    catch { if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError"); throw new Error("The PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
    if (document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error(`PDF files must contain 1-${PDF_LIMITS.pages} pages.`);
    const selectedPages = resolvePageSelection(settings.pages, document.numPages);
    const { extractPdfHtmlPages, buildPdfHtml, buildPdfHtmlPackage } = await import("./pdf-html");
    const extracted = await extractPdfHtmlPages(document, {
      pages: selectedPages,
      signal,
      includePictures: settings.includePictures !== false,
      onProgress: (completedPages, totalPages) => onProgress({ completedPages, totalPages }),
    });
    const characterCount = extracted.pages.reduce((total, page) => total + page.blocks.reduce((sum, block) => {
      if (block.kind === "text" || block.kind === "heading") return sum + block.text.length;
      if (block.kind === "table") return sum + block.rows.flat().reduce((cells, cell) => cells + cell.length, 0);
      return sum;
    }, 0), 0);
    const pictureCount = extracted.pages.reduce((total, page) => total + page.blocks.filter((block) => block.kind === "image").length, 0);
    if (characterCount === 0 && pictureCount === 0) {
      throw new Error("No selectable text or pictures were found in the selected pages. Scanned pages need OCR before text can be extracted.");
    }
    const title = settings.title?.trim() || file.name.replace(/\.[^.]+$/, "") || "PDF reading view";
    const mode = settings.layout === "layout" ? "layout" : "reading";
    const options = {
      mode,
      includeImages: settings.includePictures !== false,
      includeTables: settings.includeTables !== false,
      includePageLabels: settings.includePageLabels !== false,
    } as const;
    const html = buildPdfHtml(title, extracted.pages, options);
    const bytes = new TextEncoder().encode(html);
    validateHtmlOutput(bytes);
    const packaged = buildPdfHtmlPackage(title, extracted.pages, options);
    if (packaged.archive.byteLength < 22 || packaged.archive[0] !== 0x50 || packaged.archive[1] !== 0x4b) throw new Error("The generated HTML package failed ZIP validation.");
    const entries = unzipSync(packaged.archive);
    if (!entries["index.html"]) throw new Error("The generated HTML package has no index.html entry.");
    for (const [name] of Object.entries(entries)) {
      if (name.startsWith("/") || name.includes("..") || name.includes("\\")) throw new Error("The generated HTML package contains an unsafe entry name.");
    }
    const packageText = new TextDecoder().decode(entries["index.html"]);
    for (const match of packageText.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) {
      if (!entries[match[1]]) throw new Error("The generated HTML package is missing a referenced picture.");
    }
    const emptyPages = extracted.pages.filter((page) => page.blocks.length === 0).map((page) => page.page);
    const warnings = [
      ...(characterCount === 0 ? ["This PDF has no selectable text; the HTML contains pictures only. Run OCR PDF for searchable text."] : []),
      ...(emptyPages.length ? [`${emptyPages.length} selected page(s) had no extractable content: ${emptyPages.join(", ")}.`] : []),
    ];
    return {
      bytes,
      pageCount: extracted.totalPages,
      characterCount,
      emptyPages,
      warnings,
      archive: { bytes: packaged.archive, name: `${(file.name.replace(/\.[^.]+$/, "") || "document").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.zip` },
    };
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    if (input?.byteLength) input.fill(0);
    if (loadingTask) { try { await loadingTask.destroy(); } catch { /* PDF.js may already have destroyed a cancelled task. */ } }
  }
}
