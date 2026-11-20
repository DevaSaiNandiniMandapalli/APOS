import type { PDFPageProxy } from "pdfjs-dist";
import { checkPdfHeader } from "./pdf-limits";

export const VERIFY_LIMITS = {
  perFileBytes: 25 * 1024 * 1024,
  maxPages: 100,
  renderScale: 1.2,
  previewWidth: 900,
  visualTolerance: 12,
  changedPixelPercent: 0.5,
  textSimilarityPercent: 99.5,
} as const;

export type VerifyPageStatus =
  | "identical"
  | "text-changed"
  | "visual-change"
  | "size-changed"
  | "missing-before"
  | "missing-after";

export type VerifyPageResult = {
  page: number;
  status: VerifyPageStatus;
  visualChangePercent: number;
  visualSimilarityPercent: number;
  textSimilarityPercent: number;
  textAddedWords: number;
  textRemovedWords: number;
  beforeCharacters: number;
  afterCharacters: number;
  sizeChanged: boolean;
};

export type VerifyReport = {
  beforeName: string;
  afterName: string;
  beforePages: number;
  afterPages: number;
  comparedPages: number;
  identicalPages: number;
  textChangedPages: number;
  visualChangedPages: number;
  sizeChangedPages: number;
  missingPages: number;
  averageVisualSimilarityPercent: number;
  averageTextSimilarityPercent: number;
  verdict: "identical" | "minor-differences" | "changed" | "major-differences";
  warnings: string[];
  pages: VerifyPageResult[];
};

export type VerifyPreview = {
  beforeUrl: string;
  afterUrl: string;
  width: number;
  height: number;
};

export function normaliseVerifyText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  const normalised = normaliseVerifyText(value).toLowerCase();
  return normalised ? normalised.split(" ").filter(Boolean) : [];
}

export function textSimilarity(before: string, after: string): {
  similarityPercent: number;
  addedWords: number;
  removedWords: number;
  beforeWords: number;
  afterWords: number;
} {
  const beforeWords = words(before);
  const afterWords = words(after);
  if (!beforeWords.length && !afterWords.length) return { similarityPercent: 100, addedWords: 0, removedWords: 0, beforeWords: 0, afterWords: 0 };
  const counts = new Map<string, number>();
  for (const word of beforeWords) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of afterWords) {
    const remaining = counts.get(word) ?? 0;
    if (remaining > 0) {
      common += 1;
      counts.set(word, remaining - 1);
    }
  }
  const total = beforeWords.length + afterWords.length;
  return {
    similarityPercent: total ? (2 * common / total) * 100 : 100,
    addedWords: Math.max(0, afterWords.length - common),
    removedWords: Math.max(0, beforeWords.length - common),
    beforeWords: beforeWords.length,
    afterWords: afterWords.length,
  };
}

export function visualChangePercent(before: Uint8ClampedArray, after: Uint8ClampedArray, tolerance = VERIFY_LIMITS.visualTolerance): number {
  const length = Math.min(before.length, after.length);
  if (!length) return 100;
  let changed = 0;
  let pixels = 0;
  for (let index = 0; index + 3 < length; index += 4) {
    pixels += 1;
    if (
      Math.abs(before[index] - after[index]) > tolerance ||
      Math.abs(before[index + 1] - after[index + 1]) > tolerance ||
      Math.abs(before[index + 2] - after[index + 2]) > tolerance
    ) {
      changed += 1;
    }
  }
  return pixels ? (changed / pixels) * 100 : 100;
}

export function classifyPage(result: Omit<VerifyPageResult, "status">): VerifyPageStatus {
  if (result.beforeCharacters === -1) return "missing-before";
  if (result.afterCharacters === -1) return "missing-after";
  if (result.sizeChanged) return "size-changed";
  if (result.textSimilarityPercent < VERIFY_LIMITS.textSimilarityPercent) return "text-changed";
  if (result.visualChangePercent > VERIFY_LIMITS.changedPixelPercent) return "visual-change";
  return "identical";
}

export function summariseVerifyReport(report: Omit<VerifyReport, "verdict" | "warnings" | "averageVisualSimilarityPercent" | "averageTextSimilarityPercent" | "identicalPages" | "textChangedPages" | "visualChangedPages" | "sizeChangedPages" | "missingPages">): VerifyReport {
  const pages = report.pages;
  const common = pages.filter((page) => page.beforeCharacters >= 0 && page.afterCharacters >= 0);
  const missingPages = pages.filter((page) => page.status === "missing-before" || page.status === "missing-after").length;
  const identicalPages = pages.filter((page) => page.status === "identical").length;
  const textChangedPages = pages.filter((page) => page.status === "text-changed").length;
  const visualChangedPages = pages.filter((page) => page.status === "visual-change").length;
  const sizeChangedPages = pages.filter((page) => page.status === "size-changed").length;
  const averageVisualSimilarityPercent = common.length
    ? common.reduce((total, page) => total + page.visualSimilarityPercent, 0) / common.length
    : 0;
  const averageTextSimilarityPercent = common.length
    ? common.reduce((total, page) => total + page.textSimilarityPercent, 0) / common.length
    : 0;
  const warnings: string[] = [];
  if (report.beforePages !== report.afterPages) warnings.push(`Page count changed from ${report.beforePages} to ${report.afterPages}.`);
  if (missingPages) warnings.push(`${missingPages} page(s) exist in only one document.`);
  if (sizeChangedPages) warnings.push(`${sizeChangedPages} page(s) changed page size.`);
  if (textChangedPages) warnings.push(`${textChangedPages} page(s) have text differences.`);
  if (visualChangedPages) warnings.push(`${visualChangedPages} page(s) have visual differences above the tolerance.`);

  let verdict: VerifyReport["verdict"];
  if (!warnings.length) verdict = "identical";
  else if (averageVisualSimilarityPercent >= 98 && averageTextSimilarityPercent >= 99 && !missingPages) verdict = "minor-differences";
  else if (averageVisualSimilarityPercent >= 85 && averageTextSimilarityPercent >= 90 && !missingPages) verdict = "changed";
  else verdict = "major-differences";

  return {
    ...report,
    identicalPages,
    textChangedPages,
    visualChangedPages,
    sizeChangedPages,
    missingPages,
    averageVisualSimilarityPercent,
    averageTextSimilarityPercent,
    verdict,
    warnings,
  };
}

function assertPdfFile(file: File, label: string) {
  if (!file.size) throw new Error(`${label} is empty.`);
  if (file.size > VERIFY_LIMITS.perFileBytes) throw new Error(`${label} is larger than 25 MB.`);
}

async function loadPdf(file: File, pdfjs: typeof import("pdfjs-dist")) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfHeader(bytes)) throw new Error(`${file.name} does not have a PDF signature.`);
  const loading = pdfjs.getDocument({ data: bytes });
  const document = await loading.promise;
  return { document, loading };
}

function canvasFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot create a comparison canvas.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function renderPage(page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const { canvas, context } = canvasFor(viewport.width, viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

async function pageText(page: PDFPageProxy) {
  const content = await page.getTextContent();
  return content.items.map((item) => "str" in item ? item.str : "").join(" ");
}

function drawPageInto(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  const context = target.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot create a comparison canvas.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);
}

export async function comparePdfPair(
  beforeFile: File,
  afterFile: File,
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
): Promise<VerifyReport> {
  assertPdfFile(beforeFile, "The original PDF");
  assertPdfFile(afterFile, "The result PDF");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const before = await loadPdf(beforeFile, pdfjs);
  const after = await loadPdf(afterFile, pdfjs);
  const beforePages = before.document.numPages;
  const afterPages = after.document.numPages;
  const total = Math.max(beforePages, afterPages);
  if (total > VERIFY_LIMITS.maxPages) {
    await before.document.cleanup();
    await before.loading.destroy();
    await after.document.cleanup();
    await after.loading.destroy();
    throw new Error(`Compare at most ${VERIFY_LIMITS.maxPages} pages at a time. Split the files first.`);
  }

  const pages: VerifyPageResult[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(total, VERIFY_LIMITS.maxPages); pageNumber += 1) {
      if (options.signal?.aborted) throw new DOMException("Comparison cancelled", "AbortError");
      const beforePage = pageNumber <= beforePages ? await before.document.getPage(pageNumber) : null;
      const afterPage = pageNumber <= afterPages ? await after.document.getPage(pageNumber) : null;
      let beforeText = "";
      let afterText = "";
      let changedVisualPercent = 0;
      let sizeChanged = false;
      let width = 0;
      let height = 0;
      let beforeCanvas: HTMLCanvasElement | null = null;
      let afterCanvas: HTMLCanvasElement | null = null;
      try {
        beforeText = beforePage ? await pageText(beforePage) : "";
        afterText = afterPage ? await pageText(afterPage) : "";
        if (beforePage && afterPage) {
          const beforeViewport = beforePage.getViewport({ scale: 1 });
          const afterViewport = afterPage.getViewport({ scale: 1 });
          sizeChanged = Math.abs(beforeViewport.width - afterViewport.width) > 2 || Math.abs(beforeViewport.height - afterViewport.height) > 2;
          beforeCanvas = await renderPage(beforePage, VERIFY_LIMITS.renderScale);
          afterCanvas = await renderPage(afterPage, VERIFY_LIMITS.renderScale);
          width = Math.max(beforeCanvas.width, afterCanvas.width);
          height = Math.max(beforeCanvas.height, afterCanvas.height);
          const comparisonBefore = canvasFor(width, height);
          const comparisonAfter = canvasFor(width, height);
          drawPageInto(comparisonBefore.canvas, beforeCanvas);
          drawPageInto(comparisonAfter.canvas, afterCanvas);
          const beforeData = comparisonBefore.context.getImageData(0, 0, width, height).data;
          const afterData = comparisonAfter.context.getImageData(0, 0, width, height).data;
          changedVisualPercent = visualChangePercent(beforeData, afterData);
          comparisonBefore.canvas.width = 0;
          comparisonBefore.canvas.height = 0;
          comparisonAfter.canvas.width = 0;
          comparisonAfter.canvas.height = 0;
        }
      } finally {
        if (beforeCanvas) { beforeCanvas.width = 0; beforeCanvas.height = 0; }
        if (afterCanvas) { afterCanvas.width = 0; afterCanvas.height = 0; }
        beforePage?.cleanup();
        afterPage?.cleanup();
      }

      const text = textSimilarity(beforeText, afterText);
      const base: Omit<VerifyPageResult, "status"> = {
        page: pageNumber,
        visualChangePercent: changedVisualPercent,
        visualSimilarityPercent: Math.max(0, 100 - changedVisualPercent),
        textSimilarityPercent: text.similarityPercent,
        textAddedWords: text.addedWords,
        textRemovedWords: text.removedWords,
        beforeCharacters: beforePage ? beforeText.length : -1,
        afterCharacters: afterPage ? afterText.length : -1,
        sizeChanged,
      };
      pages.push({ ...base, status: classifyPage(base) });
      options.onProgress?.(pageNumber, total);
    }
  } finally {
    await before.document.cleanup();
    await before.loading.destroy();
    await after.document.cleanup();
    await after.loading.destroy();
  }

  return summariseVerifyReport({
    beforeName: beforeFile.name,
    afterName: afterFile.name,
    beforePages,
    afterPages,
    comparedPages: Math.min(beforePages, afterPages),
    pages,
  });
}

export async function renderVerifyPreview(
  beforeFile: File,
  afterFile: File,
  pageNumber: number,
): Promise<VerifyPreview> {
  assertPdfFile(beforeFile, "The original PDF");
  assertPdfFile(afterFile, "The result PDF");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const before = await loadPdf(beforeFile, pdfjs);
  const after = await loadPdf(afterFile, pdfjs);
  try {
    const beforePage = pageNumber <= before.document.numPages ? await before.document.getPage(pageNumber) : null;
    const afterPage = pageNumber <= after.document.numPages ? await after.document.getPage(pageNumber) : null;
    const beforeCanvas = beforePage ? await renderPage(beforePage, VERIFY_LIMITS.renderScale) : null;
    const afterCanvas = afterPage ? await renderPage(afterPage, VERIFY_LIMITS.renderScale) : null;
    const width = Math.max(beforeCanvas?.width ?? 0, afterCanvas?.width ?? 0);
    const height = Math.max(beforeCanvas?.height ?? 0, afterCanvas?.height ?? 0);
    const previewWidth = Math.min(VERIFY_LIMITS.previewWidth, width || 1);
    const previewHeight = Math.round((height || 1) * (previewWidth / (width || 1)));
    const makeUrl = (source: HTMLCanvasElement | null) => {
      if (!source) return "";
      const target = canvasFor(previewWidth, previewHeight);
      drawPageInto(target.canvas, source);
      const url = target.canvas.toDataURL("image/png");
      target.canvas.width = 0;
      target.canvas.height = 0;
      return url;
    };
    const result = {
      beforeUrl: makeUrl(beforeCanvas),
      afterUrl: makeUrl(afterCanvas),
      width: previewWidth,
      height: previewHeight,
    };
    if (beforeCanvas) { beforeCanvas.width = 0; beforeCanvas.height = 0; }
    if (afterCanvas) { afterCanvas.width = 0; afterCanvas.height = 0; }
    beforePage?.cleanup();
    afterPage?.cleanup();
    return result;
  } finally {
    await before.document.cleanup();
    await before.loading.destroy();
    await after.document.cleanup();
    await after.loading.destroy();
  }
}
