import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { CONVERSION_LIMITS, validatePlainTextOutput } from "./conversion-engine";

export type PdfTextDocument = Pick<PDFDocumentProxy, "numPages" | "getPage">;
export type PdfTextPage = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export type PdfTextItem = { str: string; hasEOL?: boolean } | { type: string };
export type PdfTextProgress = { completedPages: number; totalPages: number };

export type PdfTextSettings = { includePageLabels: boolean; title?: string };

export async function extractPdfDocumentText(
  document: PdfTextDocument,
  settings: PdfTextSettings,
  signal: AbortSignal,
  onProgress: (progress: PdfTextProgress) => void,
) {
  if (document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error(`PDF files must contain 1-${PDF_LIMITS.pages} pages.`);
  const pages: string[] = [];
  onProgress({ completedPages: 0, totalPages: document.numPages });
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    try {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item: PdfTextItem) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+\n/g, "\n").trim();
      const section = settings.includePageLabels ? `--- Page ${pageNumber} ---${text ? `\n${text}` : ""}` : text;
      pages.push(section);
      page.cleanup();
      const measured = pages.join("\n\n").length;
      if (measured > CONVERSION_LIMITS.outputCharacters) throw new Error("Extracted text exceeds the 20 MB output limit. Use fewer or smaller PDFs.");
      onProgress({ completedPages: pageNumber, totalPages: document.numPages });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new DOMException("Conversion cancelled", "AbortError");
      if (error instanceof Error && error.message.includes("20 MB output limit")) throw error;
      throw new Error(`Page ${pageNumber} text could not be extracted. The PDF may contain unsupported or damaged page content.`);
    }
  }
  const bytes = new TextEncoder().encode(pages.join("\n\n"));
  validatePlainTextOutput(bytes);
  return { bytes, pageCount: document.numPages, characterCount: pages.join("\n\n").length };
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
    return await extractPdfDocumentText(document, settings, signal, onProgress);
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
    const { extractPdfHtmlPages, buildPdfHtml } = await import("./pdf-html");
    const extracted = await extractPdfHtmlPages(document, {
      signal,
      onProgress: (completedPages, totalPages) => onProgress({ completedPages, totalPages }),
    });
    const html = buildPdfHtml(settings.title ?? "PDF reading view", extracted.pages);
    const bytes = new TextEncoder().encode(html);
    const characterCount = extracted.pages.reduce((total, page) => total + page.blocks.reduce((sum, block) => sum + (block.kind === "text" ? block.text.length : 0), 0), 0);
    return { bytes, pageCount: extracted.totalPages, characterCount };
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    if (input?.byteLength) input.fill(0);
    if (loadingTask) { try { await loadingTask.destroy(); } catch { /* PDF.js may already have destroyed a cancelled task. */ } }
  }
}
