import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { renderPdfPicturePages } from "./pdf-page-images";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { CONVERSION_LIMITS, validatePlainTextOutput } from "./conversion-engine";

export type PdfTextDocument = Pick<PDFDocumentProxy, "numPages" | "getPage">;
export type PdfTextPage = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export type PdfTextItem = { str: string; hasEOL?: boolean } | { type: string };
export type PdfTextProgress = { completedPages: number; totalPages: number };

export type PdfTextSettings = { includePageLabels: boolean };

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
  const textResult = await convertPdfFileToText(file, settings, signal, onProgress);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(textResult.bytes);
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pictures = await renderPdfPicturePages(file as File, { signal, scale: 1.5 });
    const imageMarkup = pictures.pages.map((picture) => `<figure><img src="${picture.dataUrl}" alt="Page ${picture.page} of the original document" width="${picture.width}" height="${picture.height}"><figcaption>Page ${picture.page}</figcaption></figure>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF text extraction</title><style>body{max-width:900px;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#20212b}pre{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:1.5rem 0}img{max-width:100%;height:auto;border:1px solid #d8dae5;border-radius:6px}figcaption{color:#5b5f74;font-size:13px}</style></head><body><main><pre>${escaped}</pre>${imageMarkup ? `<section aria-label="Page pictures"><h2>Page pictures</h2>${imageMarkup}</section>` : ""}</main></body></html>`;
    const bytes = new TextEncoder().encode(html);
    return { bytes, pageCount: textResult.pageCount, characterCount: textResult.characterCount };
  } finally { textResult.bytes.fill(0); }
}
