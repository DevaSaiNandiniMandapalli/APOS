import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type SignaturePlacement = "bottom-left" | "bottom-center" | "bottom-right" | "center" | "top-left" | "top-center" | "top-right";

export const SIGNATURE_PLACEMENTS: SignaturePlacement[] = [
  "top-left", "top-center", "top-right",
  "center",
  "bottom-left", "bottom-center", "bottom-right",
];

/** Draws a typed signature (with a signing line) on the chosen page. */
export async function signPdf(
  bytes: Uint8Array,
  options: { text: string; page: number; placement: SignaturePlacement; fontSize?: number; color?: "ink" | "black" | "blue" },
) {
  if (!bytes.byteLength) throw new PdfInputError("empty", "Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  const label = options.text.trim();
  if (!label) throw new PdfInputError("invalid-pdf", "Type the name or text to sign with.");
  if (label.length > 80) throw new PdfInputError("invalid-pdf", "Signatures are limited to 80 characters.");
  const fontSize = options.fontSize ?? 24;
  if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 72) throw new PdfInputError("invalid-pdf", "Choose a signature size from 10 to 72 points.");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const count = pdf.getPageCount();
  if (options.page < 1 || options.page > count) throw new PdfInputError("invalid-pages", `Choose a page from 1 to ${count}.`);
  const page = pdf.getPage(options.page - 1);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  const margin = Math.max(36, fontSize * 1.5);
  const [vertical, horizontal] = options.placement.split("-");
  const x = horizontal === "left" ? margin : horizontal === "right" ? width - margin - textWidth : (width - textWidth) / 2;
  const y = vertical === "top" ? height - margin - fontSize : vertical === "bottom" ? margin + fontSize * 0.6 : (height - fontSize) / 2;
  const ink = options.color === "blue" ? rgb(0.09, 0.22, 0.65) : options.color === "black" ? rgb(0.1, 0.1, 0.1) : rgb(0.12, 0.2, 0.55);
  page.drawText(label, { x, y, size: fontSize, font, color: ink });
  page.drawLine({ start: { x: x - 4, y: y - fontSize * 0.35 }, end: { x: x + textWidth + 4, y: y - fontSize * 0.35 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.25) });
  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  if (!checkPdfHeader(output)) throw new PdfInputError("invalid-pdf", "The signed PDF failed its signature check.");
  return output;
}

export type RedactionBox = { page: number; x: number; y: number; width: number; height: number };

/** Rasterizes the pages that carry redaction boxes so the covered content is truly gone. */
export async function redactPdf(
  file: File,
  boxes: RedactionBox[],
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
) {
  if (!boxes.length) throw new PdfInputError("invalid-pdf", "Draw at least one redaction box.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = pdfjs.getDocument({ data });
  const doc = await loading.promise;
  const out = await PDFDocument.create();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new PdfInputError("invalid-pdf", "This browser cannot render pages for redaction.");
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      if (options.signal?.aborted) throw new DOMException("Redaction cancelled", "AbortError");
      const page = await doc.getPage(index);
      const pageBoxes = boxes.filter((box) => box.page === index);
      const base = page.getViewport({ scale: 1 });
      if (pageBoxes.length) {
        const scale = 2;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        context.fillStyle = "#000000";
        for (const box of pageBoxes) {
          context.fillRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
        }
        const jpeg = await out.embedJpg(canvas.toDataURL("image/jpeg", 0.92));
        out.addPage([base.width, base.height]).drawImage(jpeg, { x: 0, y: 0, width: base.width, height: base.height });
      } else {
        const [copied] = await out.copyPages(await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false }), [index - 1]);
        out.addPage(copied);
      }
      options.onProgress?.(index, doc.numPages);
    }
  } finally {
    await doc.cleanup();
    await loading.destroy();
  }
  return new Uint8Array(await out.save({ useObjectStreams: true }));
}

/** Rebuilds an encrypted PDF you may open as a new file without a password. */
export async function unlockPdf(
  file: File,
  password: string,
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = pdfjs.getDocument({ data, password });
  let doc;
  try { doc = await loading.promise; }
  catch { throw new PdfInputError("invalid-pdf", "That password did not open this PDF."); }
  const out = await PDFDocument.create();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new PdfInputError("invalid-pdf", "This browser cannot render pages.");
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      if (options.signal?.aborted) throw new DOMException("Unlock cancelled", "AbortError");
      const page = await doc.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1.6 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const jpeg = await out.embedJpg(canvas.toDataURL("image/jpeg", 0.9));
      out.addPage([base.width, base.height]).drawImage(jpeg, { x: 0, y: 0, width: base.width, height: base.height });
      options.onProgress?.(index, doc.numPages);
    }
  } finally {
    await doc.cleanup();
    await loading.destroy();
  }
  return new Uint8Array(await out.save({ useObjectStreams: true }));
}

export function isPdfEncryptedError(reason: unknown) {
  return reason instanceof Error && /password|encrypt/i.test(reason.message);
}


