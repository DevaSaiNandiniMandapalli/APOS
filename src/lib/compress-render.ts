import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";
import { parsePageRanges } from "./split-pdf";

export type CompressLevel = "light" | "medium" | "strong" | "extreme";

export const COMPRESS_LEVELS: { value: CompressLevel; label: string; detail: string; dpi: number; quality: number; targetKb: number }[] = [
  { value: "light", label: "Low · less compression", detail: "~1 MB or higher · minimal quality loss, best for 1–2 MB portal limits", dpi: 160, quality: 0.85, targetKb: 1200 },
  { value: "medium", label: "Medium · recommended", detail: "~500 KB · text stays crisp, coloured seals and stamps stay readable", dpi: 120, quality: 0.7, targetKb: 500 },
  { value: "strong", label: "High · extreme", detail: "~200 KB · maximum reduction for strict caps, some image softness", dpi: 96, quality: 0.55, targetKb: 220 },
  { value: "extreme", label: "Smallest", detail: "~120 KB · visible image quality loss", dpi: 72, quality: 0.42, targetKb: 140 },
];

const KEYWORD = new Set(["light", "medium", "strong", "extreme"]);

export function isCompressLevel(value: string): value is CompressLevel {
  return KEYWORD.has(value);
}

function pagesToRender(value: string, pageCount: number) {
  if (!value.trim()) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const ranges = parsePageRanges(value, pageCount);
  return ranges.flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, index) => first + index));
}

export async function compressByRendering(
  bytes: Uint8Array,
  options: { level: CompressLevel; pages?: string; targetKb?: number; onProgress?: (done: number, total: number) => void },
) {
  if (!bytes.byteLength) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const targets = new Set(pagesToRender(options.pages ?? "", pageCount));
  const preset = COMPRESS_LEVELS.find((item) => item.value === options.level) ?? COMPRESS_LEVELS[1];

  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await loading.promise;
  const attempts: { dpi: number; quality: number }[] = [{ dpi: preset.dpi, quality: preset.quality }];
  let dpi = preset.dpi;
  let quality = preset.quality;
  for (let step = 0; step < 12; step += 1) {
    dpi = Math.max(50, Math.round(dpi * 0.86));
    quality = Math.max(0.25, Number((quality - 0.06).toFixed(2)));
    attempts.push({ dpi, quality });
  }

  const build = async ({ dpi: scaleDpi, quality: jpegQuality }: { dpi: number; quality: number }) => {
    const out = await PDFDocument.create();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new PdfInputError("invalid-pdf", "This browser cannot render PDF pages for compression.");
    const order: number[] = [];
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: scaleDpi / 72 });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      if (width * height > 16_000_000) throw new PdfInputError("too-large", "A page is too large to render at this level. Try a lower level.");
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      if (targets.has(index)) {
        const base = source.getPage(index - 1).getSize();
        const image = await out.embedJpg(canvas.toDataURL("image/jpeg", jpegQuality));
        const added = out.addPage([base.width, base.height]);
        added.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
      } else {
        order.push(index);
      }
      options.onProgress?.(index, pageCount);
    }
    if (order.length) {
      const copied = await out.copyPages(source, order.map((index) => index - 1));
      const preserved: number[] = [];
      for (let index = 0; index < pageCount; index += 1) if (!targets.has(index + 1)) preserved.push(index);
      copied.forEach((page, position) => out.insertPage(preserved[position], page));
    }
    return new Uint8Array(await out.save({ useObjectStreams: true }));
  };

  let best: Uint8Array | null = null;
  const limit = options.targetKb && options.targetKb > 0 ? options.targetKb * 1024 : preset.targetKb * 1024;
  for (const attempt of attempts) {
    const candidate = await build(attempt);
    if (!best || candidate.byteLength < best.byteLength) {
      if (best) best.fill(0);
      best = candidate;
    } else {
      candidate.fill(0);
    }
    if (!limit || (best && best.byteLength <= limit)) break;
  }
  await doc.cleanup();
  await loading.destroy();
  if (!best) throw new PdfInputError("invalid-pdf", "Compression produced no output.");
  if (!checkPdfHeader(best)) throw new PdfInputError("invalid-pdf", "The compressed PDF failed its signature check.");
  return { bytes: best, pageCount, inputBytes: bytes.byteLength, outputBytes: best.byteLength, renderedPages: targets.size };
}
