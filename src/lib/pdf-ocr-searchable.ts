import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { checkPdfHeader } from "./pdf-limits";

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };

/** One OCR'd page: the rendered page picture plus the recognised word boxes. */
export type OcrPageImage = {
  pageNumber: number;
  png: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  pointWidth: number;
  pointHeight: number;
  words: OcrWord[];
};

/** Helvetica can only encode WinAnsi; drop anything else instead of throwing. */
const UNENCODABLE = /[^\u0020-\u007e\u00a0-\u00ff]/g;

export function sanitizeOcrWord(text: string) {
  return text.replace(UNENCODABLE, "").trim();
}

export const SEARCHABLE_PDF_LIMITS = { maxWordsPerPage: 4000 } as const;

/**
 * Builds a PDF where every OCR'd page is the rendered picture with an invisible,
 * selectable text layer placed over the recognised words. Pages that were not
 * OCR'd are copied through unchanged so the output is always the whole document.
 */
export async function buildSearchablePdf(source: Uint8Array, pages: readonly OcrPageImage[]): Promise<Uint8Array> {
  if (!source.byteLength) throw new Error("Choose a PDF to make searchable.");
  if (!checkPdfHeader(source)) throw new Error("This file does not have a PDF signature.");
  if (!pages.length) throw new Error("Run OCR on at least one page first.");

  const input = await PDFDocument.load(source, { updateMetadata: false });
  const pageCount = input.getPageCount();
  if (pageCount < 1) throw new Error("This PDF has no pages.");

  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));

  for (let index = 1; index <= pageCount; index += 1) {
    const ocr = byPage.get(index);
    if (!ocr) {
      const [copied] = await output.copyPages(input, [index - 1]);
      output.addPage(copied);
      continue;
    }

    const image = await output.embedPng(ocr.png);
    const width = ocr.pointWidth > 0 ? ocr.pointWidth : image.width;
    const height = ocr.pointHeight > 0 ? ocr.pointHeight : image.height;
    const page = output.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const scaleX = width / (ocr.pixelWidth || width);
    const scaleY = height / (ocr.pixelHeight || height);
    let drawn = 0;
    for (const word of ocr.words) {
      if (drawn >= SEARCHABLE_PDF_LIMITS.maxWordsPerPage) break;
      const text = sanitizeOcrWord(word.text);
      if (!text) continue;
      const size = Math.max(1, (word.y1 - word.y0) * scaleY);
      const x = word.x0 * scaleX;
      const y = height - word.y1 * scaleY;
      try {
        page.drawText(text, { x, y, size, font, opacity: 0 });
        drawn += 1;
      } catch {
        // A word the built-in font cannot encode is skipped; the page picture still shows it.
      }
    }
  }

  const bytes = new Uint8Array(await output.save({ useObjectStreams: true }));
  if (!checkPdfHeader(bytes)) throw new Error("The searchable PDF failed its signature check.");
  const verified = await PDFDocument.load(bytes, { updateMetadata: false });
  if (verified.getPageCount() !== pageCount) throw new Error("The searchable PDF failed its page-count check.");
  return bytes;
}
