import { PDF_LIMITS, PdfInputError } from "./pdf-limits";
import { parsePageRanges, type PageRange } from "./split-pdf";

export const PDF_IMAGE_LIMITS = {
  pagesPerExport: 20,
  pixelsPerPage: 12_000_000,
  totalPixels: 30_000_000,
  totalBytes: 25 * 1024 * 1024,
} as const;

export function selectedImagePages(value: string, pageCount: number) {
  const ranges: PageRange[] = parsePageRanges(value, pageCount);
  const pages = ranges.flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset));
  if (!pages.length) throw new PdfInputError("invalid-pages", "Select at least one page.");
  if (pages.length > PDF_IMAGE_LIMITS.pagesPerExport) throw new PdfInputError("too-many-outputs", `Choose no more than ${PDF_IMAGE_LIMITS.pagesPerExport} pages per export.`);
  return pages;
}

export function validateRenderedImage(bytes: Uint8Array, format: "png" | "jpeg") {
  const valid = format === "png"
    ? bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!valid) throw new PdfInputError("invalid-pdf", "A rendered page failed image validation.");
}

export function safeFileStem(filename: string) {
  return filename.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
}

export function assertImageWorkBounds(width: number, height: number, totalPixels: number) {
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > PDF_IMAGE_LIMITS.pixelsPerPage) throw new PdfInputError("too-large", "A selected page exceeds the 12-megapixel rendering limit. Lower the output resolution.");
  if (totalPixels + pixels > PDF_IMAGE_LIMITS.totalPixels) throw new PdfInputError("too-large", "The selected pages exceed the 30-megapixel total rendering limit. Export fewer pages or use a lower resolution.");
  return pixels;
}

export function checkInputLimits(bytes: number) {
  if (bytes === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
}
